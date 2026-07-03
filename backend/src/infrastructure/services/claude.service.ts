import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  LlmUsageRecorder,
  LlmUsageContext,
} from './llm-usage-recorder.service';

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
  fullText?: string;
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

@Injectable()
export class ClaudeService {
  constructor(private readonly usageRecorder: LlmUsageRecorder) {}

  private getClient(apiKey: string): Anthropic {
    return new Anthropic({ apiKey });
  }

  /**
   * 自然言語を要求定義に変換
   */
  async parseRequirements(
    naturalLanguageText: string,
    apiKey: string,
    usage?: LlmUsageContext,
  ): Promise<RequirementParseResult> {
    const client = this.getClient(apiKey);
    const model = this.defaultModel();

    const systemPrompt = `あなたはシステム開発の要求分析の専門家です。
ユーザーが入力した自然言語のテキストを、システム開発用の要求定義に変換してください。

出力は必ず以下のJSON形式で返してください：
{
  "requirements": [
    {
      "title": "要求のタイトル（簡潔に）",
      "description": "要求の詳細説明（具体的に、測定可能な形で）",
      "type": "FUNCTIONAL | NON_FUNCTIONAL | BUSINESS_RULE | CONSTRAINT | INTERFACE | DATA",
      "priority": "HIGH | MEDIUM | LOW",
      "children": [
        // 子要求がある場合は同じ構造でネスト
      ]
    }
  ]
}

要求タイプの説明：
- FUNCTIONAL: システムが実行すべき機能
- NON_FUNCTIONAL: 性能、セキュリティ、可用性などの品質要求
- BUSINESS_RULE: ビジネスロジックやルール
- CONSTRAINT: 制約条件
- INTERFACE: 外部システムとの連携
- DATA: データに関する要求

注意点：
1. 曖昧な表現は具体的な要求に変換する
2. 大きな要求は階層構造で分解する
3. 測定可能で検証可能な形で記述する
4. 必ず有効なJSONのみを出力する（説明文は不要）`;

    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `以下のテキストを要求定義に変換してください：

${naturalLanguageText}`,
        },
      ],
      system: systemPrompt,
    });
    if (usage) await this.usageRecorder.record(usage, model, (response as any).usage);

    // レスポンスからテキストを抽出
    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('Claude APIからの応答が不正です');
    }

    // JSONをパース
    try {
      // JSONブロックを抽出（```json ... ``` の形式も対応）
      let jsonText = textContent.text;
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }
      
      const result = JSON.parse(jsonText.trim());
      return result as RequirementParseResult;
    } catch (err) {
      console.error('JSON parse error:', textContent.text);
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
    const client = this.getClient(apiKey);
    const model = this.defaultModel();

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `以下の要求をより詳細に記述し、受け入れ基準を作成してください。

要求タイトル: ${requirement.title}
現在の説明: ${requirement.description}
コンテキスト: ${context}

以下のJSON形式で出力してください：
{
  "description": "詳細な説明",
  "acceptanceCriteria": ["基準1", "基準2", ...]
}`,
        },
      ],
    });
    if (usage) await this.usageRecorder.record(usage, model, (response as any).usage);

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('Claude APIからの応答が不正です');
    }

    try {
      let jsonText = textContent.text;
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
    const client = this.getClient(apiKey);
    const model = this.defaultModel();

    const systemPrompt = `あなたは業務フロー図の解析の専門家です。
与えられた Mermaid 図（flowchart または sequenceDiagram／プロトコル図）を、スイムレーン業務フロー用の「ロール（役割／レーン）」「ノード」「エッジ」に変換してください。

出力は必ず以下のJSON形式で返してください：
{
  "roles": [
    { "name": "ロール名（レーン名）", "type": "HUMAN | SYSTEM | OTHER" }
  ],
  "nodes": [
    { "key": "ノードID", "label": "ノードのラベル", "type": "START | END | PROCESS | DECISION | SYSTEM_INTEGRATION | MANUAL_OPERATION | DATA_STORE", "roleName": "所属するロール名" }
  ],
  "edges": [
    { "sourceKey": "始点ノードID", "targetKey": "終点ノードID", "label": "遷移ラベル（任意）" }
  ]
}

【共通ルール】
A. roleName は roles の name と必ず一致させる。ロール type はシステム/外部システムなら SYSTEM、人手の操作なら HUMAN、判断できなければ HUMAN。
B. 必ず有効なJSONのみを出力する（説明文・コードフェンス以外の文章は不要）。

【flowchart の場合】
1. node.key は Mermaid のノードID（例: A, node1）をそのまま使う。
2. label は Mermaid のノードに書かれた表示テキスト（["..."], ("..."), {"..."} などの中身）を使う。
3. subgraph やラベル（例: [担当者名] のような注記、subgraphタイトル）からスイムレーンのロールを推測する。ロールが明示されていなければ妥当な単一ロール（例: "担当者"）を1つ作り、全ノードをそれに割り当てる。
4. node.type は形状から推測する：開始/終了の丸は START/END、ひし形({})は DECISION、円柱([(...)])は DATA_STORE、それ以外の四角は PROCESS。判断できなければ PROCESS。
5. edges は Mermaid の矢印（-->, -->|label| など）から抽出し、label がある場合のみ含める。

【sequenceDiagram（プロトコル図）の場合】★スイムレーンに最も自然に対応する
6. participant / actor 宣言を「ロール（レーン）」にする。「participant A as 受付」のように別名があれば表示名（受付）を name に使う。順序は宣言順。
7. 各メッセージ（A->>B: 注文する / A-->>B: ... / A-)B: ... 等）を1つの「ノード」にする。label はメッセージ本文（コロンの右側）。**roleName は送信側（矢印の左側＝動作主体）のロール**にする。node.key は m1, m2, ... と出現順に振る。
8. ノードの順序＝メッセージの出現順。edges は連続するメッセージ node を出現順に繋ぐ（m1→m2→m3 …）。基本 label は不要（ラベルはノード側が持つため）。
9. alt / opt / else などの分岐は、その直前に DECISION ノード（label は条件文）を挿入し、各分岐の先頭メッセージへ分岐させる（条件は edge.label にしてよい）。loop はそのまま順次フローとして表現してよい。判断が難しければ無理に分岐させず順次フローにする。
10. 自己メッセージ（A->>A: ...）や返信（-->>）も、送信側レーンのノードとして扱う。Note/activate/deactivate は無視してよい。`;

    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `以下の Mermaid 図を業務フローに変換してください：

${mermaid}`,
        },
      ],
      system: systemPrompt,
    });
    if (usage) await this.usageRecorder.record(usage, model, (response as any).usage);

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('Claude APIからの応答が不正です');
    }

    try {
      let jsonText = textContent.text;
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
      console.error('JSON parse error:', textContent.text);
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
    const client = this.getClient(apiKey);
    const model = this.defaultModel();

    const systemPrompt = `あなたはデータモデル図の解析の専門家です。
与えられた Mermaid 図を、オブジェクト関係性マップ用の「オブジェクト（object）」と「関係（relation）」に変換してください。
erDiagram / classDiagram / flowchart のいずれの Mermaid でも対応すること。

抽出ルール：
1. エンティティ（erDiagram）/ クラス（classDiagram）/ ノード（flowchart）を **object** として抽出する。
2. 関係（erDiagram の関係線）/ 関連（classDiagram の association）/ エッジ（flowchart の矢印）を **relation** として抽出する。
3. relation の source / target は **object 名**（表示名）で表す。Mermaid のノードIDではなく、人が読む名前を使う。
4. 多重度記法がある場合は cardinality に反映する：
   - "||--||"（1対1）→ "ONE_TO_ONE"
   - "||--o{" / "||--|{"（1対多）→ "ONE_TO_MANY"
   - "}o--o{" / "}|--|{"（多対多）→ "MANY_TO_MANY"
   - 判断できなければ cardinality は省略してよい。
5. 関係/エッジにラベル（例: erの関係ラベル、flowchart の -->|label|）があれば label に入れる。
6. object に説明（classDiagram のコメント等）があれば description に入れる。無ければ省略する。

出力は必ず以下のJSON形式のみで返してください（説明文・コードフェンス以外の文章は不要）：
{
  "objects": [
    { "name": "オブジェクト名", "description": "説明（任意）" }
  ],
  "relations": [
    { "source": "始点オブジェクト名", "target": "終点オブジェクト名", "cardinality": "ONE_TO_ONE | ONE_TO_MANY | MANY_TO_MANY", "label": "関係ラベル（任意）" }
  ]
}`;

    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `以下の Mermaid 図をオブジェクト関係性マップに変換してください：

${mermaid}`,
        },
      ],
      system: systemPrompt,
    });
    if (usage) await this.usageRecorder.record(usage, model, (response as any).usage);

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('Claude APIからの応答が不正です');
    }

    try {
      let jsonText = textContent.text;
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
      console.error('JSON parse error:', textContent.text);
      throw new Error('Mermaid図の解析に失敗しました');
    }
  }

  /**
   * 既定モデル（既存 CodeExtractionService と同じ規約に従う）
   */
  private defaultModel(): string {
    return process.env.EXTRACTION_MODEL || 'claude-sonnet-4-6';
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
    const client = this.getClient(apiKey);
    const usedModel = model || this.defaultModel();

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

    const systemPrompt = `あなたは文書からナレッジグラフ要素を抽出する専門家です。出力は指定されたJSONのみ。
- tags / entities の label は簡潔な名詞句にする。
- relations の from / to は必ず tags か entities に現れる label を使う。
- 該当が無い配列は空配列で返す。${
      needsFullText
        ? '\n- fullText には文書本文をできるだけ忠実に全文書き起こす（要約しない）。'
        : ''
    }
- 必ず有効なJSONのみを出力する（説明文・コードフェンス以外の文章は不要）。`;

    const response = await client.messages.create({
      model: usedModel,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content }],
    });
    if (usage) await this.usageRecorder.record(usage, usedModel, (response as any).usage);

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('Claude APIからの応答が不正です');
    }

    const parsed = this.extractJsonObject(textContent.text);
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
      fullText:
        typeof parsed?.fullText === 'string' && parsed.fullText.trim()
          ? parsed.fullText
          : undefined,
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
    const client = this.getClient(apiKey);
    const model = this.defaultModel();

    const systemPrompt = `あなたは経営課題解決のロジックツリー（イシューツリー）設計の専門家です。
与えられた対象ノードの子として妥当な候補を、MECE（モレなくダブりなく）を意識して提案してください。

ツリーパターンの意味：
- ISSUE_POINT: イシューツリー（論点を疑問形で分解）
- WHY: Whyツリー（なぜ→原因を掘り下げる）
- WHAT: Whatツリー（対象を構成要素に分割）
- HOW: Howツリー（打ち手を発散させる）
- MECE_ACTION: MECEアクションツリー（打ち手を網羅的に列挙）
- KPI: KPIツリー（指標を分解）

提案ルール：
1. 候補は必ず ${'`'}label${'`'} と ${'`'}kind${'`'} を持つオブジェクトの配列で返す。
2. 候補は 3〜6 件。
3. すべての候補の kind は "${context.expectedKind}"（${context.expectedKindLabel}）に統一する。
4. label は対象ノードの直下の子として自然な粒度・表現にする（疑問形が適切なら疑問形）。
5. 互いに重複せず、対象ノードの内容に直接ぶら下がる候補にする。
6. 出力は必ず有効なJSONのみ（説明文・コードフェンス以外の文章は不要）。

出力フォーマット：
{
  "suggestions": [
    { "label": "候補のラベル", "kind": "${context.expectedKind}" }
  ]
}`;

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

    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: lines.join('\n'),
        },
      ],
      system: systemPrompt,
    });
    if (usage) await this.usageRecorder.record(usage, model, (response as any).usage);

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('Claude APIからの応答が不正です');
    }

    try {
      let jsonText = textContent.text;
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
      console.error('JSON parse error:', textContent.text);
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
    const client = this.getClient(apiKey);
    const model = this.defaultModel();

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

    const systemPrompt = `あなたは業務改善・AI導入プロジェクトのKPI設計の専門家です。
与えられたコンテキスト（業務フロー・情報種別・システム）に基づき、SMART原則（Specific/Measurable/Achievable/Relevant/Time-bound）を意識したKPI候補を提案してください。
${context.category === 'AI_QUALITY' ? aiQualityGuide : businessGuide}

出力は必ず以下のJSON配列のみを返してください（説明文・コードフェンス以外の文章は不要）：
[
  {
    "name": "KPI名（簡潔に・日本語）",
    "description": "KPIの説明（何を測るか・なぜ重要か）",
    "definition": "計算式（例: 欠品率 = 欠品件数 / 発注明細数）",
    "unit": "単位（% / 件 / 分 / 円 など）",
    "direction": "INCREASE | DECREASE | MAINTAIN",
    "frequency": "DAILY | WEEKLY | MONTHLY | QUARTERLY",
    "baselineValue": 現状値の数値（不明なら省略可）,
    "targetValue": 目標値の数値（不明なら省略可）,
    "measurementMethod": "測定方法・データソース（どのデータからどう算出するか）",
    "smartSpecific": 0〜5の整数,
    "smartMeasurable": 0〜5の整数,
    "smartAchievable": 0〜5の整数,
    "smartRelevant": 0〜5の整数,
    "smartTimeBound": 0〜5の整数,
    "smartComment": "SMART評価の講評（改善点があれば指摘）"
  }
]

ルール：
1. 候補は必ず ${context.count} 件提案する。
2. direction は「増やすほど良い指標なら INCREASE、減らすほど良いなら DECREASE、維持すべきなら MAINTAIN」。
3. measurementMethod には与えられた情報種別（帳票・データ）をデータソースとして活用する。
4. smart の5軸は自己採点（0〜5の整数）し、smartComment に講評を書く。
5. 必ず有効なJSONのみを出力する。`;

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

    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: lines.join('\n'),
        },
      ],
      system: systemPrompt,
    });
    if (usage) await this.usageRecorder.record(usage, model, (response as any).usage);

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('Claude APIからの応答が不正です');
    }

    // コードフェンス除去 + JSON.parse（失敗時は throw → 呼び出し側で1リトライ）
    let jsonText = textContent.text;
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
    const client = this.getClient(apiKey);
    const model = this.defaultModel();

    const systemPrompt = `あなたはプロジェクト管理のエキスパートです。Excelから抽出した表データ（Markdown）を読み取り、タスク一覧に構造化してください。

読み取りルール：
1. 列の意味を内容から推測する（列名は固定でない）。例: 「大項目」「中項目」「カテゴリ」→ 階層、「タスク」「作業」「件名」→ タイトル、「担当」「担当者」→ 担当、「開始」→ 開始日、「期限」「締切」「納期」→ 期限、「状態」「ステータス」→ 状態、「優先度」→ 優先度。
2. 階層化する：大項目・中項目のようなグルーピング列があれば、それを親タスクにし、実作業を子タスク(children)として入れ子にする。グルーピングが無ければフラットでよい。
3. 同じ大項目/中項目が複数行で繰り返される場合、親はまとめて1つにする（重複生成しない）。
4. 日付は YYYY-MM-DD に正規化する（年が不明な場合は省略）。判別不能な値は省略する。
5. 見出し行・空行・合計行・凡例などタスクでないものは除外する。
6. status は OPEN / IN_PROGRESS / RESOLVED / CLOSED のいずれか（判別できなければ省略）。priority は HIGH / MEDIUM / LOW（判別できなければ省略）。

出力は必ず次のJSONのみ（コードフェンスや説明文は不要）：
{
  "tasks": [
    {
      "title": "タスク名（必須）",
      "description": "補足（任意）",
      "status": "OPEN | IN_PROGRESS | RESOLVED | CLOSED（任意）",
      "priority": "HIGH | MEDIUM | LOW（任意）",
      "assigneeName": "担当者名（任意）",
      "startDate": "YYYY-MM-DD（任意）",
      "dueDate": "YYYY-MM-DD（任意）",
      "children": [ { 同じ構造 } ]
    }
  ]
}`;

    const userText = [
      instructions && instructions.trim() ? `追加指示: ${instructions.trim()}\n` : '',
      '次のExcelデータを読み取り、上記JSON構造のタスク木に変換してください。\n',
      '--- Excel（Markdown） ---',
      markdown.slice(0, 60000), // 過大入力をガード（約60k文字）
    ].join('\n');

    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userText }],
    });
    if (usage) await this.usageRecorder.record(usage, model, (response as any).usage);

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('Claude APIからの応答が不正です');
    }
    let jsonText = textContent.text;
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
}

