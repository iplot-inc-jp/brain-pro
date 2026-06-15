import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  LlmUsageRecorder,
  LlmUsageContext,
} from './llm-usage-recorder.service';

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

  constructor(private readonly usageRecorder: LlmUsageRecorder) {}

  private getClient(apiKey: string): Anthropic {
    return new Anthropic({ apiKey });
  }

  private model(): string {
    return process.env.EXTRACTION_MODEL || 'claude-sonnet-4-6';
  }

  private systemPrompt(): string {
    return `You are an expert software architect that reverse-engineers a codebase into a data/permission catalog.
あなたはソースコードを読み解き、データ/権限カタログを逆算する専門家です。

Analyze the provided source files and extract:
以下を抽出してください：
1. apis: HTTP API endpoints (controllers / routers / route definitions).
   - method: HTTP method in UPPERCASE (GET/POST/PUT/PATCH/DELETE).
   - path: route path (e.g. "/users/:id"). Combine controller prefix + handler path when possible.
   - summary: short Japanese or English description if inferable.
   - sourceFile: the file path where it is defined.
2. tables: data models / DB tables (Prisma models, SQL tables, ORM entities).
   - name: table/model name.
   - displayName: human-readable name if inferable (optional).
   - columns: array of { name, dataType } where dataType is one of
     STRING|INTEGER|FLOAT|BOOLEAN|DATE|DATETIME|JSON|TEXT|UUID (best guess; default STRING).
   - statuses: array of { value, label?, order? } if the model has an obvious status/state enum
     (e.g. order_status with draft/approved). Empty array if none.
3. roles: actor roles / permission roles found in the code (e.g. ADMIN, USER, system actors).
   - name: role name.
   - type: one of HUMAN|SYSTEM|OTHER (best guess; HUMAN for human users, SYSTEM for automated/services).

RULES:
- Output ONLY a single JSON object. No prose, no markdown, no explanation.
- The JSON MUST match exactly this shape:
{
  "apis": [{ "method": "GET", "path": "/example", "summary": "...", "sourceFile": "..." }],
  "tables": [{ "name": "User", "displayName": "ユーザー", "columns": [{ "name": "id", "dataType": "UUID" }], "statuses": [{ "value": "active", "label": "有効", "order": 0 }] }],
  "roles": [{ "name": "ADMIN", "type": "HUMAN" }]
}
- Do not invent entities that are not supported by the code. If something is empty, use an empty array.
- Deduplicate. Use exact identifiers found in the code.`;
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
    const model = this.model();

    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      system: this.systemPrompt(),
      messages: [{ role: 'user', content: userContent }],
    });
    if (usage) await this.usageRecorder.record(usage, model, (response as any).usage);

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
