import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  LlmUsageRecorder,
  LlmUsageContext,
} from './llm-usage-recorder.service';
import { PromptService } from '../prompts/prompt.service';

/**
 * 抽出結果の共通シェイプ（Build エージェント間で合意済み）。
 */
export interface ExtractResult {
  apis: {
    method: string;
    path: string;
    summary?: string;
    sourceFile?: string;
  }[];
  tables: {
    name: string;
    displayName?: string;
    columns: { name: string; dataType?: string }[];
    statuses: { value: string; label?: string; order?: number }[];
  }[];
  roles: { name: string; type?: 'HUMAN' | 'SYSTEM' | 'OTHER' }[];
}

/**
 * Claude(Anthropic)を使って、ソースコードやスキーマテキストから
 * API エンドポイント / テーブル(カラム・ステータス) / ロール を抽出する。
 *
 * SDK 0.71.2 では messages.parse / zodOutputFormat が使えないため、
 * claude.service.ts と同じく messages.create でテキストを得て、
 * ```json フェンスを許容しつつ JSON.parse する。
 */
@Injectable()
export class CodeExtractionService {
  private readonly logger = new Logger(CodeExtractionService.name);

  constructor(
    private readonly usageRecorder: LlmUsageRecorder,
    private readonly prompts: PromptService,
  ) {}

  private getClient(apiKey: string): Anthropic {
    return new Anthropic({ apiKey });
  }

  /** ソースファイル群（path + content）から抽出する。 */
  async extractFromCode(
    files: { path: string; content: string }[],
    apiKey: string,
    usage?: LlmUsageContext,
  ): Promise<ExtractResult> {
    if (!files.length) {
      return { apis: [], tables: [], roles: [] };
    }

    const blocks = files
      .map(
        (f) =>
          `===== FILE: ${f.path} =====\n${f.content}`,
      )
      .join('\n\n');

    const userContent = `Extract the catalog from the following source files. 以下のソースファイルからカタログを抽出してください。\n\n${blocks}`;

    return this.runExtraction(userContent, apiKey, usage);
  }

  /** スキーマ貼り付けテキスト（Prisma/SQL等）から抽出する。 */
  async extractFromSchemaText(
    schemaText: string,
    apiKey: string,
    usage?: LlmUsageContext,
  ): Promise<ExtractResult> {
    if (!schemaText || !schemaText.trim()) {
      return { apis: [], tables: [], roles: [] };
    }

    const userContent = `Extract the catalog from the following schema text (e.g. Prisma schema, SQL DDL, or model definitions). 以下のスキーマテキストからカタログを抽出してください。\n\n===== SCHEMA =====\n${schemaText}`;

    return this.runExtraction(userContent, apiKey, usage);
  }

  private async runExtraction(
    userContent: string,
    apiKey: string,
    usage?: LlmUsageContext,
  ): Promise<ExtractResult> {
    const client = this.getClient(apiKey);
    const prompt = await this.prompts.resolve(
      'code-extract',
      usage?.projectId,
      usage?.userId,
    );
    const usageCtx = usage
      ? { ...usage, promptVersionId: prompt.promptVersionId ?? usage.promptVersionId ?? null }
      : undefined;

    const response = await client.messages.create({
      model: prompt.model,
      max_tokens: 8192,
      system: prompt.systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });
    if (usageCtx) await this.usageRecorder.record(usageCtx, prompt.model, (response as any).usage);

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('Claude APIからの応答が不正です（テキストなし）');
    }

    return this.parseResult(textContent.text);
  }

  /** ```json フェンスを許容しつつ JSON をパースし、ExtractResult に正規化する。 */
  private parseResult(text: string): ExtractResult {
    let jsonText = text;
    const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonText.trim());
    } catch (err) {
      this.logger.error(`抽出結果のJSONパースに失敗しました: ${text.slice(0, 500)}`);
      throw new Error('コード解析結果の解析に失敗しました');
    }

    return this.normalize(parsed);
  }

  private normalize(parsed: any): ExtractResult {
    const result: ExtractResult = { apis: [], tables: [], roles: [] };
    if (!parsed || typeof parsed !== 'object') return result;

    result.apis = Array.isArray(parsed.apis)
      ? parsed.apis
          .filter((a: any) => a && a.method && a.path)
          .map((a: any) => ({
            method: String(a.method).toUpperCase(),
            path: String(a.path),
            summary: a.summary ? String(a.summary) : undefined,
            sourceFile: a.sourceFile ? String(a.sourceFile) : undefined,
          }))
      : [];

    result.tables = Array.isArray(parsed.tables)
      ? parsed.tables
          .filter((t: any) => t && t.name)
          .map((t: any) => ({
            name: String(t.name),
            displayName: t.displayName ? String(t.displayName) : undefined,
            columns: Array.isArray(t.columns)
              ? t.columns
                  .filter((c: any) => c && c.name)
                  .map((c: any) => ({
                    name: String(c.name),
                    dataType: c.dataType ? String(c.dataType) : undefined,
                  }))
              : [],
            statuses: Array.isArray(t.statuses)
              ? t.statuses
                  .filter((s: any) => s && s.value !== undefined && s.value !== null)
                  .map((s: any, i: number) => ({
                    value: String(s.value),
                    label: s.label ? String(s.label) : undefined,
                    order: typeof s.order === 'number' ? s.order : i,
                  }))
              : [],
          }))
      : [];

    result.roles = Array.isArray(parsed.roles)
      ? parsed.roles
          .filter((r: any) => r && r.name)
          .map((r: any) => ({
            name: String(r.name),
            type: this.normalizeRoleType(r.type),
          }))
      : [];

    return result;
  }

  private normalizeRoleType(type: any): 'HUMAN' | 'SYSTEM' | 'OTHER' | undefined {
    if (typeof type !== 'string') return undefined;
    const upper = type.toUpperCase();
    if (upper === 'HUMAN' || upper === 'SYSTEM' || upper === 'OTHER') {
      return upper;
    }
    return undefined;
  }
}
