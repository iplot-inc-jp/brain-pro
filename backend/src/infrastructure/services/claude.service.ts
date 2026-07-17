import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  LlmUsageRecorder,
  LlmUsageContext,
} from './llm-usage-recorder.service';
import {
  AnthropicTransport,
  IproBotTransport,
  IproBotGatewayError,
  hasNonTextContent,
  LlmRunRequest,
  LlmRunResult,
} from './llm-transport';
import { IproBotGatewayService } from './ipro-bot-gateway.service';
import {
  parseRagCompressionResponse,
  RagCompressionResult,
  RagCompressionConfig,
  RagSourceItem,
} from '../rag/rag.types';
import { PromptService, ResolvedPrompt } from '../prompts/prompt.service';
import { renderPromptTemplate } from '../prompts/prompt-registry';

export interface RequirementParseResult {
  requirements: Array<{
    title: string;
    description: string;
    type: 'FUNCTIONAL' | 'NON_FUNCTIONAL' | 'BUSINESS_RULE' | 'CONSTRAINT' | 'INTERFACE' | 'DATA';
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    children?: RequirementParseResult['requirements'];
  }>;
}

export interface MermaidFlowParseResult {
  roles: Array<{ name: string; type?: 'HUMAN' | 'SYSTEM' | 'OTHER' }>;
  nodes: Array<{
    key: string;
    label: string;
    type?: string;
    roleName?: string;
  }>;
  edges: Array<{ sourceKey: string; targetKey: string; label?: string }>;
}

export type ObjectMapCardinality = 'ONE_TO_ONE' | 'ONE_TO_MANY' | 'MANY_TO_MANY';

/**
 * Mermaid（erDiagram / classDiagram / flowchart）から抽出したオブジェクト関係性マップ。
 * object はエンティティ/クラス/ノード、relation は関係/エッジ。source/target は object 名で表す。
 */
export interface MermaidObjectMapParseResult {
  objects: Array<{ name: string; description?: string }>;
  relations: Array<{
    source: string;
    target: string;
    cardinality?: ObjectMapCardinality;
    label?: string;
  }>;
}

/**
 * イシューツリー用「生成AI候補」の入力コンテキスト
 */
export interface IssueNodeSuggestContext {
  /** ツリーのパターン（ISSUE_POINT / WHY / WHAT / HOW / MECE_ACTION / KPI） */
  pattern: string;
  /** ツリー名 */
  treeName: string;
  /** ルートの問い（任意） */
  rootQuestion?: string | null;
  /** 対象ノードのラベル */
  targetLabel: string;
  /** 対象ノードの種別 */
  targetKind: string;
  /** ルートから対象ノードまでの親チェーンのラベル（対象ノードは含まない） */
  parentLabels: string[];
  /** 期待される候補の種別（kind）。文脈から決定済み */
  expectedKind: string;
  /** 期待される候補種別の説明（プロンプト用） */
  expectedKindLabel: string;
  /** 紐づくGAPの業務領域（任意） */
  gapBusinessArea?: string | null;
  /** 紐づくGAPのギャップ説明（任意） */
  gapDescription?: string | null;
  /** ユーザーからの補足（任意） */
  userContext?: string | null;
  /** 発想法の名称（任意）。与えると、その観点で具体的な子候補を起案する */
  ideationMethodName?: string | null;
  /** 発想法のレンズ（観点）の配列（任意） */
  ideationLenses?: string[] | null;
}

/**
 * 生成AIが返すイシューノード候補
 */
export interface IssueNodeSuggestion {
  label: string;
  kind: string;
}

/**
 * KPI生成（GenerateKpisUseCase）の入力コンテキスト
 */
export interface GenerateKpisContext {
  /** KPI区分: 業務KPI（BUSINESS）/ AI精度KPI（AI_QUALITY） */
  category: 'BUSINESS' | 'AI_QUALITY';
  /** 対象業務フロー名（任意） */
  flowName?: string | null;
  /** 対象フローの種別（ASIS | TOBE。任意） */
  flowKind?: string | null;
  /** 対象システム名（AI_QUALITY時。任意） */
  systemName?: string | null;
  /** 測定対象の情報種別（名前＋帳票/情報/物体の別） */
  informationTypes: Array<{ name: string; categoryLabel: string }>;
  /** ユーザーからの追加指示（任意） */
  instructions?: string | null;
  /** 生成件数 */
  count: number;
}

/**
 * 生成AIが返すKPI候補（1件分。値の妥当化は呼び出し側で行う）
 */
/** Excel→タスク抽出の入れ子ノード（大項目/中項目を children で表現）。 */
export interface ExtractedTaskNode {
  title: string;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
  assigneeName?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  children?: ExtractedTaskNode[] | null;
}

export interface GeneratedKpiItem {
  name: string;
  description?: string | null;
  definition?: string | null;
  unit?: string | null;
  direction?: string | null;
  frequency?: string | null;
  baselineValue?: number | null;
  targetValue?: number | null;
  measurementMethod?: string | null;
  smartSpecific?: number | null;
  smartMeasurable?: number | null;
  smartAchievable?: number | null;
  smartRelevant?: number | null;
  smartTimeBound?: number | null;
  smartComment?: string | null;
}

/**
 * ナレッジグラフ抽出（バッチ取り込みパイプラインの EXTRACT ステップ）の出力契約。
 * spec §6「EXTRACT 出力契約」と一致する。from/to は tags か entities の label を指す。
 */
export interface KnowledgeExtraction {
  /** 3行以内の要約 */
  summary: string;
  /**
   * 文書本文の全文プレーンテキスト（PDF/画像など、前処理でテキスト層を取れない
   * 入力で AI が読み取った本文）。検索/RAG の土台として KnowledgeDocument.contentText に保持する。
   * テキスト系入力（前処理で全文を持っている）では空でよい。
   */
  fullText: string;
  /** 主題タグ（簡潔な名詞句） */
  tags: string[];
  /** 固有物（実体） */
  entities: Array<{ label: string; kind: string; description?: string }>;
  /** ノード間の関係。from/to は tags か entities に現れる label */
  relations: Array<{ from: string; to: string; label?: string }>;
}

/**
 * extractKnowledge() への多モーダル入力。型別前処理（spec §6）の結果を渡し分ける：
 * - PDF → document コンテンツブロック（base64）
 * - 画像 → image コンテンツブロック（base64）
 * - テキスト（Excel→Markdown表 / docx / text 等）→ text
 * いずれか1つ以上を与える（全て空でも呼び出し側の責任で許容）。
 */
export interface ExtractInput {
  /** テキスト系（Excel→Markdown表 / docx / text/md/json 等） */
  text?: string;
  /** PDF を base64 で（document ブロック） */
  pdfBase64?: string;
  /** 画像を base64 で（image ブロック）。複数ページ画像にも対応 */
  images?: Array<{ base64: string; mimeType: string }>;
  /** 元ファイル名（プロンプトに埋め込む） */
  filename: string;
}

/**
 * プロジェクト充実度（Readiness）分析の入力。
 * 各セクションは方法論エリアの設定件数（count）と目安（target）と状態を持つ。
 */
export interface ReadinessSectionInput {
  key: string;
  label: string;
  group: string;
  count: number;
  target: number;
  status: 'empty' | 'started' | 'rich';
}

export interface ReadinessSummaryInput {
  projectName?: string | null;
  overallPercent: number;
  sections: ReadinessSectionInput[];
}

/** LLM（Haiku）が返す充実度分析。 */
export interface ReadinessAnalysis {
  /** 全体状況の一言サマリ */
  headline: string;
  /** 今 優先して着手すべきこと */
  priorities: Array<{ title: string; detail: string }>;
  /** 抜け漏れ・リスクの注意点 */
  watchouts: string[];
}

@Injectable()
export class ClaudeService {
  private readonly logger = new Logger(ClaudeService.name);

  constructor(
    private readonly usageRecorder: LlmUsageRecorder,
    private readonly gatewayService: IproBotGatewayService,
    private readonly prompts: PromptService,
  ) {}

  /**
   * プロンプト設定（DB管理）を解決する。usage に projectId があれば
   * プロジェクトのアクティブ版、無ければレジストリの既定値を使う。
   */
  private resolvePrompt(
    key: string,
    usage?: LlmUsageContext,
  ): Promise<ResolvedPrompt> {
    return this.prompts.resolve(key, usage?.projectId, usage?.userId);
  }

  /** 使用量記録にプロンプト版IDを紐づける。 */
  private withPromptVersion(
    usage: LlmUsageContext | undefined,
    prompt: ResolvedPrompt,
  ): LlmUsageContext | undefined {
    if (!usage) return undefined;
    return {
      ...usage,
      promptVersionId: prompt.promptVersionId ?? usage.promptVersionId ?? null,
    };
  }
  /**
   * LLM 1回実行の共通経路。組織の ipro-bot 連携が有効ならゲートウェイ経由、
   * それ以外・マルチモーダル・フォールバック時は直接 Anthropic を呼ぶ。
   */
  private async runLlm(input: {
    apiKey: string;
    model: string;
    maxTokens: number;
    system?: string;
    messages: Anthropic.MessageParam[];
    usage?: LlmUsageContext;
    /** ipro-bot の IPLoT頭脳(skill)を明示指定（ゲートウェイ経由時のみ効く）。 */
    skill?: string;
  }): Promise<LlmRunResult> {
    const direct = new AnthropicTransport(input.apiKey);
    const req: LlmRunRequest = {
      model: input.model,
      maxTokens: input.maxTokens,
      system: input.system,
      messages: input.messages,
      taskType: input.usage?.area ?? 'OTHER',
      skill: input.skill,
      projectRef: input.usage?.projectId ? { projectId: input.usage.projectId } : undefined,
    };

    // マルチモーダル（PDF/画像）はゲートウェイのボディ上限にかかるため P1 では直接実行
    if (hasNonTextContent(input.messages)) return direct.run(req);

    const gateway = await this.gatewayService.resolveForProject(input.usage?.projectId);
    if (!gateway) return direct.run(req);

    const via = new IproBotTransport(gateway.baseUrl, gateway.apiToken);
    try {
      return await via.run(req);
    } catch (err) {
      const status = err instanceof IproBotGatewayError ? err.status : null;
      if (status === 401 || gateway.strict) throw err; // 設定ミスは顕在化 / strict はフォールバック禁止
      this.logger.warn(
        `ipro-botゲートウェイ失敗のため直接Anthropicへフォールバック: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return direct.run(req);
    }
  }

  /**
   * 自然言語を要求定義に変換
   */
  async parseRequirements(
    naturalLanguageText: string,
    apiKey: string,
    usage?: LlmUsageContext,
  ): Promise<RequirementParseResult> {
    const prompt = await this.resolvePrompt('requirement-parse', usage);
    const usageCtx = this.withPromptVersion(usage, prompt);

    const run = await this.runLlm({
      apiKey,
      model: prompt.model,
      maxTokens: 8192,
      system: prompt.systemPrompt,
      messages: [
        {
          role: 'user',
          content: `以下のテキストを要求定義に変換してください：

${naturalLanguageText}`,
        },
      ],
      usage: usageCtx,
    });
    if (usageCtx) await this.usageRecorder.record(usageCtx, run.model, run.usage);

    if (!run.text) {
      throw new Error('Claude APIからの応答が不正です');
    }

    // JSONをパース
    try {
      // JSONブロックを抽出（```json ... ``` の形式も対応）
      let jsonText = run.text;
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }

      const result = JSON.parse(jsonText.trim());
      return result as RequirementParseResult;
    } catch (err) {
      console.error('JSON parse error:', run.text);
      throw new Error('要求定義の解析に失敗しました');
    }
  }

  /**
   * 要求を詳細化する
   */
  async refineRequirement(
    requirement: { title: string; description: string },
    context: string,
    apiKey: string,
    usage?: LlmUsageContext,
  ): Promise<{ description: string; acceptanceCriteria: string[] }> {
    const prompt = await this.resolvePrompt('requirement-refine', usage);
    const usageCtx = this.withPromptVersion(usage, prompt);

    const run = await this.runLlm({
      apiKey,
      model: prompt.model,
      maxTokens: 4096,
      system: prompt.systemPrompt,
      messages: [
        {
          role: 'user',
          content: `要求タイトル: ${requirement.title}
現在の説明: ${requirement.description}
コンテキスト: ${context}`,
        },
      ],
      usage: usageCtx,
    });
    if (usageCtx) await this.usageRecorder.record(usageCtx, run.model, run.usage);

    if (!run.text) {
      throw new Error('Claude APIからの応答が不正です');
    }

    try {
      let jsonText = run.text;
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }
      return JSON.parse(jsonText.trim());
    } catch (err) {
      throw new Error('要求詳細化の解析に失敗しました');
    }
  }

  /**
   * Mermaid（flowchart または sequenceDiagram/プロトコル図）を
   * 業務フローのロール・ノード・エッジに変換。
   * sequenceDiagram は participant→ロール、メッセージ→ノード（送信側＝動作主体）に対応。
   */
  async parseMermaidToFlow(
    mermaid: string,
    apiKey: string,
    usage?: LlmUsageContext,
  ): Promise<MermaidFlowParseResult> {
    const prompt = await this.resolvePrompt('mermaid-to-flow', usage);
    const usageCtx = this.withPromptVersion(usage, prompt);

    const run = await this.runLlm({
      apiKey,
      model: prompt.model,
      maxTokens: 8192,
      system: prompt.systemPrompt,
      messages: [
        {
          role: 'user',
          content: `以下の Mermaid 図を業務フローに変換してください：

${mermaid}`,
        },
      ],
      usage: usageCtx,
    });
    if (usageCtx) await this.usageRecorder.record(usageCtx, run.model, run.usage);

    if (!run.text) {
      throw new Error('Claude APIからの応答が不正です');
    }

    try {
      let jsonText = run.text;
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }
      const result = JSON.parse(jsonText.trim());
      return {
        roles: Array.isArray(result.roles) ? result.roles : [],
        nodes: Array.isArray(result.nodes) ? result.nodes : [],
        edges: Array.isArray(result.edges) ? result.edges : [],
      } as MermaidFlowParseResult;
    } catch (err) {
      console.error('JSON parse error:', run.text);
      throw new Error('Mermaid図の解析に失敗しました');
    }
  }

  /**
   * Mermaid（erDiagram / classDiagram / flowchart）をオブジェクト関係性マップに変換。
   * エンティティ/クラス/ノードを object、関係/エッジを relation として抽出する。
   */
  async parseMermaidToObjectMap(
    mermaid: string,
    apiKey: string,
    usage?: LlmUsageContext,
  ): Promise<MermaidObjectMapParseResult> {
    const prompt = await this.resolvePrompt('mermaid-to-object-map', usage);
    const usageCtx = this.withPromptVersion(usage, prompt);

    const run = await this.runLlm({
      apiKey,
      model: prompt.model,
      maxTokens: 8192,
      system: prompt.systemPrompt,
      messages: [
        {
          role: 'user',
          content: `以下の Mermaid 図をオブジェクト関係性マップに変換してください：

${mermaid}`,
        },
      ],
      usage: usageCtx,
    });
    if (usageCtx) await this.usageRecorder.record(usageCtx, run.model, run.usage);

    if (!run.text) {
      throw new Error('Claude APIからの応答が不正です');
    }

    try {
      let jsonText = run.text;
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }
      const result = JSON.parse(jsonText.trim());
      return {
        objects: Array.isArray(result.objects) ? result.objects : [],
        relations: Array.isArray(result.relations) ? result.relations : [],
      } as MermaidObjectMapParseResult;
    } catch (err) {
      console.error('JSON parse error:', run.text);
      throw new Error('Mermaid図の解析に失敗しました');
    }
  }

  /**
   * 自然言語の業務説明から、スイムレーン業務フローの「ロール・ノード・エッジ」を生成する。
   * 出力契約は parseMermaidToFlow と同一（取り込み側の永続処理を共有するため）。
   * ipro-bot 連携時は flowKind に応じた IPLoT頭脳（asis-flow / tobe-flow）が注入される。
   */
  async generateFlowFromText(
    description: string,
    projectContext: string,
    flowKind: 'ASIS' | 'TOBE',
    apiKey: string,
    usage?: LlmUsageContext,
  ): Promise<MermaidFlowParseResult> {
    const prompt = await this.resolvePrompt('flow-from-text', usage);
    const usageCtx = this.withPromptVersion(usage, prompt);

    const run = await this.runLlm({
      apiKey,
      model: prompt.model,
      maxTokens: 8192,
      system: prompt.systemPrompt,
      messages: [
        {
          role: 'user',
          content: `${projectContext ? `【プロジェクトの前提情報】\n${projectContext}\n\n` : ''}【業務フローの種別】${flowKind === 'TOBE' ? 'TOBE（あるべき姿）' : 'ASIS（現状）'}

以下の業務説明から業務フローを設計してください：

${description}`,
        },
      ],
      usage: usageCtx,
      skill: flowKind === 'TOBE' ? 'tobe-flow' : 'asis-flow',
    });
    if (usageCtx) await this.usageRecorder.record(usageCtx, run.model, run.usage);

    if (!run.text) {
      throw new Error('Claude APIからの応答が不正です');
    }

    try {
      const result = this.extractJsonObject(run.text);
      return {
        roles: Array.isArray(result.roles) ? result.roles : [],
        nodes: Array.isArray(result.nodes) ? result.nodes : [],
        edges: Array.isArray(result.edges) ? result.edges : [],
      } as MermaidFlowParseResult;
    } catch (err) {
      console.error('JSON parse error:', run.text);
      throw new Error('業務フロー生成の解析に失敗しました');
    }
  }

  /**
   * 自然言語の説明から、オブジェクト関係性マップの「オブジェクト・関係」を生成する。
   * 出力契約は parseMermaidToObjectMap と同一（永続処理を共有するため）。
   * ipro-bot 連携時は system-landscape（企業システムの全体像）の頭脳が注入される。
   */
  async generateObjectMapFromText(
    description: string,
    projectContext: string,
    apiKey: string,
    usage?: LlmUsageContext,
  ): Promise<MermaidObjectMapParseResult> {
    const prompt = await this.resolvePrompt('object-map-from-text', usage);
    const usageCtx = this.withPromptVersion(usage, prompt);

    const run = await this.runLlm({
      apiKey,
      model: prompt.model,
      maxTokens: 8192,
      system: prompt.systemPrompt,
      messages: [
        {
          role: 'user',
          content: `${projectContext ? `【プロジェクトの前提情報】\n${projectContext}\n\n` : ''}以下の説明からオブジェクト関係性マップを設計してください：

${description}`,
        },
      ],
      usage: usageCtx,
      skill: 'system-landscape',
    });
    if (usageCtx) await this.usageRecorder.record(usageCtx, run.model, run.usage);

    if (!run.text) {
      throw new Error('Claude APIからの応答が不正です');
    }

    try {
      const result = this.extractJsonObject(run.text);
      return {
        objects: Array.isArray(result.objects) ? result.objects : [],
        relations: Array.isArray(result.relations) ? result.relations : [],
      } as MermaidObjectMapParseResult;
    } catch (err) {
      console.error('JSON parse error:', run.text);
      throw new Error('オブジェクトマップ生成の解析に失敗しました');
    }
  }

  /**
   * brain-pro の構造化データを、検索・回答コンテキスト向けの短い文書へ圧縮する。
   * sourceKey は呼び出し側の永続参照なので、要求したキーが全件ちょうど1回返ることを検証する。
   */
  async compressForRag(
    items: RagSourceItem[],
    apiKey: string,
    config: RagCompressionConfig,
    usage?: LlmUsageContext,
  ): Promise<RagCompressionResult> {
    if (items.length === 0) {
      return { documents: [], model: config.model };
    }

    const run = await this.runLlm({
      apiKey,
      model: config.model,
      maxTokens: 8192,
      system: config.systemPrompt,
      messages: [
        {
          role: 'user',
          content: `<rag_source_data>\n${JSON.stringify(items)}\n</rag_source_data>`,
        },
      ],
      usage: usage
        ? { ...usage, promptVersionId: config.promptVersionId }
        : undefined,
      skill: 'birdseye',
    });
    if (usage) {
      await this.usageRecorder.record(
        { ...usage, promptVersionId: config.promptVersionId },
        run.model,
        run.usage,
      );
    }
    if (!run.text) throw new Error('Claude APIからRAG圧縮結果が返りませんでした');

    return {
      documents: parseRagCompressionResponse(
        run.text,
        items.map((item) => item.sourceKey),
      ),
      model: run.model,
    };
  }

  /**
   * Claude のテキスト応答から JSON オブジェクトを取り出す（既存メソッドと同じコードフェンス除去ロジックを共通化）。
   * 1) ```json ... ``` フェンスがあれば中身を採用、2) それでも parse 失敗時は最初の '{' 〜 最後の '}' を抽出して再試行。
   */
  private extractJsonObject(text: string): any {
    let jsonText = text;
    const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    }
    jsonText = jsonText.trim();

    try {
      return JSON.parse(jsonText);
    } catch {
      // フェンス無しで前後に説明文が混ざるケース：最初の '{' 〜 最後の '}' を抽出して再試行
      const start = jsonText.indexOf('{');
      const end = jsonText.lastIndexOf('}');
      if (start < 0 || end <= start) {
        throw new Error('ナレッジ抽出の解析に失敗しました（JSONオブジェクトが見つかりません）');
      }
      return JSON.parse(jsonText.slice(start, end + 1));
    }
  }

  /**
   * 1ページの全文書き起こしと小さな構造化抽出を分離する。
   * 長い全文を4096-token JSONへ同居させず、全文は継続可能なplain text、
   * metadataは40k文字ごとのJSONとして取得するため途中切れを成功扱いしない。
   */
  async extractPageKnowledge(
    input: ExtractInput,
    apiKey: string,
    model?: string,
    usage?: LlmUsageContext,
    heartbeat?: () => Promise<void>,
  ): Promise<KnowledgeExtraction> {
    const hasVisual = !!input.pdfBase64 || (input.images?.length ?? 0) > 0;
    if (!hasVisual) {
      await heartbeat?.();
      const result = await this.extractKnowledge(input, apiKey, model, usage);
      await heartbeat?.();
      return result;
    }

    const visualText = await this.transcribePage(
      input,
      apiKey,
      model,
      usage,
      heartbeat,
    );
    // PPTXのテキスト層はモデルに再生成させず、原文を先頭にそのまま保持する。
    const fullText = [input.text ?? '', visualText]
      .filter((part) => part.length > 0)
      .join('\n\n');
    const chunks = this.chunkText(fullText, 40_000);
    const metadata: KnowledgeExtraction[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      await heartbeat?.();
      metadata.push(
        await this.extractKnowledge(
          {
            text: chunks[index],
            filename: `${input.filename}#metadata=${index + 1}/${chunks.length}`,
          },
          apiKey,
          model,
          usage,
        ),
      );
      await heartbeat?.();
    }
    const unique = <T>(rows: T[], key: (row: T) => string): T[] => {
      const seen = new Set<string>();
      return rows.filter((row) => {
        const value = key(row);
        if (seen.has(value)) return false;
        seen.add(value);
        return true;
      });
    };
    return {
      summary: metadata
        .map((row) => row.summary.trim())
        .filter(Boolean)
        .join('\n'),
      fullText,
      tags: unique(
        metadata.flatMap((row) => row.tags),
        (tag) => tag,
      ),
      entities: unique(
        metadata.flatMap((row) => row.entities),
        (entity) => `${entity.kind}\0${entity.label}`,
      ),
      relations: unique(
        metadata.flatMap((row) => row.relations),
        (relation) =>
          `${relation.from}\0${relation.to}\0${relation.label ?? ''}`,
      ),
    };
  }

  private async transcribePage(
    input: ExtractInput,
    apiKey: string,
    model?: string,
    usage?: LlmUsageContext,
    heartbeat?: () => Promise<void>,
  ): Promise<string> {
    const prompt = await this.resolvePrompt('page-transcribe', usage);
    const usedModel = model || prompt.model;
    const usageCtx = this.withPromptVersion(usage, prompt);
    const maxChunks = 16;
    const maxChars = 1_000_000;
    const marker = '[[PAGE_COMPLETE]]';
    let result = '';
    for (let part = 0; part < maxChunks; part += 1) {
      await heartbeat?.();
      const content: any[] = [];
      if (input.pdfBase64) {
        content.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: input.pdfBase64,
          },
        });
      }
      for (const image of input.images ?? []) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: image.mimeType,
            data: image.base64,
          },
        });
      }
      const tail = result.slice(-2_000);
      content.push({
        type: 'text',
        text:
          part === 0
            ? `「${input.filename}」の視覚情報に含まれる文字を、省略・要約せず読み順どおりplain textで全文書き起こしてください。JSONやコードフェンスは使わず、完了時だけ末尾に ${marker} を付けてください。`
            : `同じページの書き起こしを、前回出力の直後から省略なく続けてください。重複を避け、完了時だけ末尾に ${marker} を付けてください。前回末尾:\n${tail}`,
      });
      const run = await this.runLlm({
        apiKey,
        model: usedModel,
        maxTokens: 8192,
        system: prompt.systemPrompt,
        messages: [{ role: 'user', content }],
        usage: usageCtx,
      });
      if (usageCtx) await this.usageRecorder.record(usageCtx, run.model, run.usage);
      await heartbeat?.();
      if (!run.text) throw new Error('ページ全文書き起こしの応答が空です');
      const markerAt = run.text.lastIndexOf(marker);
      const piece = markerAt >= 0 ? run.text.slice(0, markerAt) : run.text;
      result = this.appendContinuation(result, piece);
      if (result.length > maxChars) {
        throw new Error(`ページ全文書き起こしが上限(${maxChars}文字)を超えました`);
      }
      if (markerAt >= 0) return result;
      if (run.stopReason !== 'max_tokens') {
        throw new Error(
          `ページ全文書き起こしが完了マーカーなしで終了しました (stopReason=${run.stopReason ?? 'unknown'})`,
        );
      }
    }
    throw new Error(`ページ全文書き起こしが継続上限(${maxChunks}回)に達しました`);
  }

  private appendContinuation(current: string, next: string): string {
    if (!current) return next;
    const limit = Math.min(2_000, current.length, next.length);
    for (let overlap = limit; overlap >= 32; overlap -= 1) {
      if (current.endsWith(next.slice(0, overlap))) {
        return current + next.slice(overlap);
      }
    }
    return current + next;
  }

  private chunkText(text: string, maxChars: number): string[] {
    const chunks: string[] = [];
    for (let offset = 0; offset < text.length; offset += maxChars) {
      chunks.push(text.slice(offset, offset + maxChars));
    }
    return chunks;
  }

  /**
   * 文書（PDF / 画像 / テキスト）から、ナレッジグラフ要素（要約・自動タグ・実体・関係）を多モーダルで抽出する。
   * バッチ取り込みパイプラインの EXTRACT ステップ（spec §6）から呼ばれる。
   * 既存メソッドと同様、1回呼び出し＋コードフェンス除去＋JSON.parse。解析失敗時は throw（リトライは呼び出し側＝Job）。
   *
   * @param input  多モーダル入力（pdfBase64 / images / text を渡し分け）
   * @param apiKey CompanyKeyService.resolveForProject で解決した API キー
   * @param model  省略時は EXTRACTION_MODEL（既定 claude-sonnet-4-6）。品質重視なら opus に切替可
   */
  async extractKnowledge(
    input: ExtractInput,
    apiKey: string,
    model?: string,
    usage?: LlmUsageContext,
  ): Promise<KnowledgeExtraction> {
    const prompt = await this.resolvePrompt('knowledge-extract', usage);
    const usedModel = model || prompt.model;
    const usageCtx = this.withPromptVersion(usage, prompt);

    // 多モーダルコンテンツブロックを組み立てる（PDF=document / 画像=image / テキスト=text）。
    // SDK の media_type は union 型で厳格なため、content は any[] で扱う（既存 messages.create 呼び出しと同等）。
    const content: any[] = [];
    if (input.pdfBase64) {
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: input.pdfBase64,
        },
      });
    }
    for (const img of input.images ?? []) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mimeType,
          data: img.base64,
        },
      });
    }
    if (input.text) {
      // 過大なテキストはトークン保護のため上限でクリップ
      content.push({ type: 'text', text: input.text.slice(0, 200_000) });
    }
    // PDF/画像は前処理でテキスト層が取れないため、本文全文（fullText）も AI に書き起こさせる
    // （KnowledgeDocument.contentText の土台。テキスト系入力では呼び出し側が抽出済みなので不要）。
    const needsFullText = !!input.pdfBase64 || (input.images?.length ?? 0) > 0;
    const fullTextField = needsFullText
      ? `,
  "fullText": "文書本文の全文をできるだけ忠実にプレーンテキストで書き起こす（レイアウトは無視可）"`
      : '';
    content.push({
      type: 'text',
      text: `上記は「${input.filename}」の内容です。日本語で、次のJSONのみを返してください（説明文・コードフェンス以外の文章は不要）：
{
  "summary": "3行以内の要約",
  "tags": ["主題タグ（簡潔な名詞句）"],
  "entities": [
    { "label": "固有物の名前", "kind": "PERSON|SYSTEM|ORG|CONCEPT|PRODUCT|EVENT|LOCATION|TERM|OTHER", "description": "任意の説明" }
  ],
  "relations": [
    { "from": "ラベル", "to": "ラベル", "label": "関係（例: 承認する/依存）" }
  ]${fullTextField}
}`,
    });

    const systemPrompt = renderPromptTemplate(prompt.systemPrompt, {
      fullTextRule: needsFullText
        ? '\n- fullText には文書本文をできるだけ忠実に全文書き起こす（要約しない）。'
        : '',
    });

    const run = await this.runLlm({
      apiKey,
      model: usedModel,
      maxTokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content }],
      usage: usageCtx,
    });
    if (usageCtx) await this.usageRecorder.record(usageCtx, run.model, run.usage);

    if (!run.text) {
      throw new Error('Claude APIからの応答が不正です');
    }

    const parsed = this.extractJsonObject(run.text);
    // LLM 出力は非文字列ノイズ（数値/null/オブジェクト）を含みうるため入口で除去する。
    const tags: string[] = Array.isArray(parsed?.tags)
      ? parsed.tags.filter((t: unknown): t is string => typeof t === 'string')
      : [];
    const entities = Array.isArray(parsed?.entities)
      ? parsed.entities.filter(
          (e: unknown): e is { label: string; kind: string; description?: string } =>
            !!e &&
            typeof e === 'object' &&
            typeof (e as { label?: unknown }).label === 'string' &&
            // relations と対称に、kind も string であることを検証する（kind 欠落の混入防止）。
            typeof (e as { kind?: unknown }).kind === 'string',
        )
      : [];
    const relations = Array.isArray(parsed?.relations)
      ? parsed.relations.filter(
          (r: unknown): r is { from: string; to: string; label?: string } =>
            !!r &&
            typeof r === 'object' &&
            typeof (r as { from?: unknown }).from === 'string' &&
            typeof (r as { to?: unknown }).to === 'string',
        )
      : [];
    return {
      summary: typeof parsed?.summary === 'string' ? parsed.summary : '',
      // ページ単位の耐久保存では毎回同じshapeを持たせる。テキスト入力など
      // 書き起こし不要な場合も空文字を返し、呼び出し側がsource textで補完できる契約。
      fullText:
        typeof parsed?.fullText === 'string' && parsed.fullText.trim()
          ? parsed.fullText
          : '',
      tags,
      entities,
      relations,
    };
  }

  /**
   * イシューツリーのノードに対する「生成AI候補」を構造化出力で生成する。
   * 候補は 3〜6 件。kind は呼び出し側が文脈から決定した expectedKind に統一する。
   */
  async suggestIssueNodes(
    context: IssueNodeSuggestContext,
    apiKey: string,
    usage?: LlmUsageContext,
  ): Promise<IssueNodeSuggestion[]> {
    const prompt = await this.resolvePrompt('issue-node-suggest', usage);
    const usageCtx = this.withPromptVersion(usage, prompt);

    const systemPrompt = renderPromptTemplate(prompt.systemPrompt, {
      expectedKind: context.expectedKind,
      expectedKindLabel: context.expectedKindLabel,
    });

    const lines: string[] = [];
    lines.push(`ツリーパターン: ${context.pattern}`);
    lines.push(`ツリー名: ${context.treeName}`);
    if (context.rootQuestion) {
      lines.push(`ルートの問い: ${context.rootQuestion}`);
    }
    if (context.parentLabels.length > 0) {
      lines.push(`親チェーン（ルート→対象の親）: ${context.parentLabels.join(' > ')}`);
    }
    lines.push(`対象ノード: ${context.targetLabel}（種別: ${context.targetKind}）`);
    if (context.gapBusinessArea) {
      lines.push(`紐づくGAPの業務領域: ${context.gapBusinessArea}`);
    }
    if (context.gapDescription) {
      lines.push(`紐づくGAPのギャップ説明: ${context.gapDescription}`);
    }
    if (context.userContext) {
      lines.push(`補足: ${context.userContext}`);
    }

    const ideationLenses = (context.ideationLenses ?? []).filter(
      (lens) => lens && lens.trim().length > 0,
    );
    const hasIdeation =
      !!context.ideationMethodName && ideationLenses.length > 0;

    lines.push('');
    if (hasIdeation) {
      lines.push(
        `次の発想法「${context.ideationMethodName}」の観点（レンズ）に沿って、対象ノードに対する**具体的で実行可能な**子ノード候補を起案せよ。各レンズにつき1〜2個。`,
      );
      lines.push('レンズ:');
      for (const lens of ideationLenses) {
        lines.push(`- ${lens}`);
      }
      lines.push('');
      lines.push(
        `すべての候補の kind は "${context.expectedKind}"（${context.expectedKindLabel}）に統一してください。`,
      );
    } else {
      lines.push(
        `上記の対象ノードの子として、kind="${context.expectedKind}"（${context.expectedKindLabel}）の候補を 3〜6 件提案してください。`,
      );
    }

    const run = await this.runLlm({
      apiKey,
      model: prompt.model,
      maxTokens: 2048,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: lines.join('\n'),
        },
      ],
      usage: usageCtx,
    });
    if (usageCtx) await this.usageRecorder.record(usageCtx, run.model, run.usage);

    if (!run.text) {
      throw new Error('Claude APIからの応答が不正です');
    }

    try {
      let jsonText = run.text;
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }
      const parsed = JSON.parse(jsonText.trim());
      const raw: unknown = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.suggestions)
          ? parsed.suggestions
          : [];
      const suggestions = (raw as Array<Record<string, unknown>>)
        .map((item) => ({
          label: typeof item?.label === 'string' ? item.label.trim() : '',
          // kind は呼び出し側が決めた expectedKind に統一（モデルのブレを吸収）
          kind: context.expectedKind,
        }))
        .filter((s) => s.label.length > 0);
      return suggestions;
    } catch (err) {
      console.error('JSON parse error:', run.text);
      throw new Error('AI候補の解析に失敗しました');
    }
  }

  /**
   * KPI候補を生成する（1回呼び出し＋コードフェンス除去＋JSON.parse）。
   * 解析失敗時は throw する。リトライは呼び出し側（GenerateKpisUseCase）が行う。
   */
  async generateKpis(
    context: GenerateKpisContext,
    apiKey: string,
    usage?: LlmUsageContext,
  ): Promise<GeneratedKpiItem[]> {
    const prompt = await this.resolvePrompt('kpi-generate', usage);
    const usageCtx = this.withPromptVersion(usage, prompt);

    const aiQualityGuide = `
このリクエストは「AI精度KPI（AI_QUALITY）」の生成です。
業務KPI（売上・リードタイム・欠品率などの業務成果指標）ではなく、導入するAI/システム**自体の品質・精度**を測る指標を提案してください。
必ず以下の精度指標の観点を踏まえること：
- 認識精度（OCR/画像認識/音声認識などの正答率）
- 適合率（Precision）/ 再現率（Recall）/ F1スコア
- 誤り率（誤認識率・誤分類率）
- 自動化率（人手を介さず処理が完結した割合）
- 人手修正率（AI出力を人が修正した割合）
- AI提案採用率（AIの提案がそのまま採用された割合）
- 処理時間（1件あたりの推論・処理時間）
- 予測誤差（MAPE・RMSE などの予測精度）`;

    const businessGuide = `
このリクエストは「業務KPI（BUSINESS）」の生成です。
対象業務フローの改善効果を測る業務成果指標（処理時間・件数・エラー率・コスト・リードタイム・欠品率など）を提案してください。`;

    const systemPrompt = renderPromptTemplate(prompt.systemPrompt, {
      categoryGuide: (context.category === 'AI_QUALITY'
        ? aiQualityGuide
        : businessGuide
      ).trim(),
      count: String(context.count),
    });

    const lines: string[] = [];
    lines.push(
      `KPI区分: ${context.category === 'AI_QUALITY' ? 'AI精度KPI（AIシステム自体の品質指標）' : '業務KPI（業務改善の成果指標）'}`,
    );
    if (context.flowName) {
      const kindLabel =
        context.flowKind === 'TOBE' ? 'TOBE（あるべき姿）' : context.flowKind === 'ASIS' ? 'ASIS（現状）' : context.flowKind ?? '';
      lines.push(`対象業務フロー: ${context.flowName}${kindLabel ? `（${kindLabel}）` : ''}`);
    }
    if (context.systemName) {
      lines.push(`対象システム: ${context.systemName}`);
    }
    if (context.informationTypes.length > 0) {
      lines.push('測定対象の情報種別（INPUT/OUTPUT）:');
      for (const it of context.informationTypes) {
        lines.push(`- ${it.name}（${it.categoryLabel}）`);
      }
    }
    if (context.instructions && context.instructions.trim().length > 0) {
      lines.push(`追加指示: ${context.instructions.trim()}`);
    }
    lines.push('');
    lines.push(`上記のコンテキストに対するKPI候補を ${context.count} 件、JSON配列で提案してください。`);

    const run = await this.runLlm({
      apiKey,
      model: prompt.model,
      maxTokens: 8192,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: lines.join('\n'),
        },
      ],
      usage: usageCtx,
    });
    if (usageCtx) await this.usageRecorder.record(usageCtx, run.model, run.usage);

    if (!run.text) {
      throw new Error('Claude APIからの応答が不正です');
    }

    // コードフェンス除去 + JSON.parse（失敗時は throw → 呼び出し側で1リトライ）
    let jsonText = run.text;
    const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    }
    jsonText = jsonText.trim();

    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      // フェンス無しで前後に説明文が混ざるケース：最初の '[' 〜 最後の ']' を抽出して再試行
      const start = jsonText.indexOf('[');
      const end = jsonText.lastIndexOf(']');
      if (start < 0 || end <= start) {
        throw new Error('KPI候補の解析に失敗しました（JSON配列が見つかりません）');
      }
      parsed = JSON.parse(jsonText.slice(start, end + 1));
    }

    const raw: unknown = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.kpis)
        ? parsed.kpis
        : null;
    // 想定外ラッパー（{"items": [...]} 等）や空配列は throw して呼び出し側のリトライを発火させる
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error('KPI候補の解析に失敗しました（候補配列が空または形式不正です）');
    }
    return raw as GeneratedKpiItem[];
  }

  /**
   * Excel（Markdown化済みの表）を読み取り、大項目/中項目などの階層・日付・担当などを推測して
   * 入れ子のタスク木に変換する。列名は固定せず、内容から意味を推測する。
   *
   * @param markdown  xlsx をMarkdownテーブル化したテキスト（全シート連結）。
   * @param instructions 任意の追加指示（読み取りのヒント）。
   * @param apiKey    解決済み Anthropic APIキー。
   */
  async extractTasksFromSpreadsheet(
    markdown: string,
    instructions: string | undefined,
    apiKey: string,
    usage?: LlmUsageContext,
  ): Promise<ExtractedTaskNode[]> {
    const prompt = await this.resolvePrompt('task-extract', usage);
    const usageCtx = this.withPromptVersion(usage, prompt);

    const userText = [
      instructions && instructions.trim() ? `追加指示: ${instructions.trim()}\n` : '',
      '次のExcelデータを読み取り、上記JSON構造のタスク木に変換してください。\n',
      '--- Excel（Markdown） ---',
      markdown.slice(0, 60000), // 過大入力をガード（約60k文字）
    ].join('\n');

    const run = await this.runLlm({
      apiKey,
      model: prompt.model,
      maxTokens: 8192,
      system: prompt.systemPrompt,
      messages: [{ role: 'user', content: userText }],
      usage: usageCtx,
    });
    if (usageCtx) await this.usageRecorder.record(usageCtx, run.model, run.usage);

    if (!run.text) {
      throw new Error('Claude APIからの応答が不正です');
    }
    let jsonText = run.text;
    const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) jsonText = fence[1];
    jsonText = jsonText.trim();

    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      const start = jsonText.indexOf('{');
      const end = jsonText.lastIndexOf('}');
      if (start < 0 || end <= start) {
        throw new Error('タスクの解析に失敗しました（JSONが見つかりません）');
      }
      parsed = JSON.parse(jsonText.slice(start, end + 1));
    }
    const tasks = Array.isArray(parsed?.tasks)
      ? parsed.tasks
      : Array.isArray(parsed)
        ? parsed
        : null;
    if (!Array.isArray(tasks)) {
      throw new Error('タスクの解析に失敗しました（tasks配列が見つかりません）');
    }
    return tasks as ExtractedTaskNode[];
  }

  /**
   * プロジェクト充実度（各方法論エリアの設定件数）を読み取り、
   * 「今 何を優先して設定・作成すべきか」「抜け漏れリスク」を助言する。
   * コスト最優先のため既定は Haiku（ANALYSIS_MODEL で上書き可）。
   */
  async analyzeProjectReadiness(
    summary: ReadinessSummaryInput,
    apiKey: string,
    usage?: LlmUsageContext,
  ): Promise<ReadinessAnalysis> {
    const prompt = await this.resolvePrompt('project-readiness', usage);
    const usageCtx = this.withPromptVersion(usage, prompt);

    const statusJp: Record<string, string> = {
      empty: '未着手',
      started: '着手',
      rich: '充実',
    };

    const lines: string[] = [];
    lines.push(`プロジェクト名: ${summary.projectName || '（無題）'}`);
    lines.push(`全体充実度: ${summary.overallPercent}%`);
    lines.push('');
    lines.push('各エリアの設定状況（グループ / エリア: 件数 / 目安 / 状態）:');
    for (const s of summary.sections) {
      lines.push(
        `- [${s.group}] ${s.label}: ${s.count}件 / 目安${s.target} / ${statusJp[s.status] ?? s.status}`,
      );
    }
    lines.push('');
    lines.push(
      '上記の設定状況を踏まえ、いま優先して着手すべきことと抜け漏れリスクを、指定JSONで助言してください。',
    );

    const run = await this.runLlm({
      apiKey,
      model: prompt.model,
      maxTokens: 2048,
      system: prompt.systemPrompt,
      messages: [{ role: 'user', content: lines.join('\n') }],
      usage: usageCtx,
    });
    if (usageCtx) await this.usageRecorder.record(usageCtx, run.model, run.usage);

    if (!run.text) {
      throw new Error('Claude APIからの応答が不正です');
    }

    const parsed = this.extractJsonObject(run.text);
    const priorities = Array.isArray(parsed?.priorities)
      ? parsed.priorities
          .filter(
            (p: unknown): p is { title: unknown; detail?: unknown } =>
              !!p && typeof p === 'object',
          )
          .map((p: { title: unknown; detail?: unknown }) => ({
            title: typeof p.title === 'string' ? p.title : '',
            detail: typeof p.detail === 'string' ? p.detail : '',
          }))
          .filter((p: { title: string }) => p.title.trim().length > 0)
      : [];
    const watchouts = Array.isArray(parsed?.watchouts)
      ? parsed.watchouts.filter(
          (w: unknown): w is string => typeof w === 'string' && w.trim().length > 0,
        )
      : [];
    return {
      headline: typeof parsed?.headline === 'string' ? parsed.headline : '',
      priorities,
      watchouts,
    };
  }

}
