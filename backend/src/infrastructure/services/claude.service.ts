import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

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

@Injectable()
export class ClaudeService {
  private getClient(apiKey: string): Anthropic {
    return new Anthropic({ apiKey });
  }

  /**
   * 自然言語を要求定義に変換
   */
  async parseRequirements(
    naturalLanguageText: string,
    apiKey: string,
  ): Promise<RequirementParseResult> {
    const client = this.getClient(apiKey);

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
      model: this.defaultModel(),
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
  ): Promise<{ description: string; acceptanceCriteria: string[] }> {
    const client = this.getClient(apiKey);

    const response = await client.messages.create({
      model: this.defaultModel(),
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
   * Mermaid（flowchart）図を業務フローのロール・ノード・エッジに変換
   */
  async parseMermaidToFlow(
    mermaid: string,
    apiKey: string,
  ): Promise<MermaidFlowParseResult> {
    const client = this.getClient(apiKey);

    const systemPrompt = `あなたは業務フロー図の解析の専門家です。
与えられた Mermaid の flowchart 図を、スイムレーン業務フロー用の「ロール（役割／レーン）」「ノード」「エッジ」に変換してください。

出力は必ず以下のJSON形式で返してください：
{
  "roles": [
    { "name": "ロール名（レーン名）", "type": "HUMAN | SYSTEM | OTHER" }
  ],
  "nodes": [
    { "key": "mermaidのノードID", "label": "ノードのラベル", "type": "START | END | PROCESS | DECISION | SYSTEM_INTEGRATION | MANUAL_OPERATION | DATA_STORE", "roleName": "所属するロール名" }
  ],
  "edges": [
    { "sourceKey": "始点ノードID", "targetKey": "終点ノードID", "label": "遷移ラベル（任意）" }
  ]
}

解析ルール：
1. node.key は Mermaid のノードID（例: A, node1）をそのまま使う。
2. label は Mermaid のノードに書かれた表示テキスト（["..."], ("..."), {"..."} などの中身）を使う。
3. subgraph やラベル（例: [担当者名] のような注記、subgraphタイトル）からスイムレーンのロールを推測する。ロールが明示されていなければ妥当な単一ロール（例: "担当者"）を1つ作り、全ノードをそれに割り当てる。
4. node.type は形状から推測する：開始/終了の丸は START/END、ひし形({})は DECISION、円柱([(...)])は DATA_STORE、それ以外の四角は PROCESS。判断できなければ PROCESS。
5. roleName は roles の name と一致させる。type（ロール）はシステム/外部システムなら SYSTEM、人手の操作なら HUMAN、判断できなければ HUMAN。
6. edges は Mermaid の矢印（-->, -->|label| など）から抽出し、label がある場合のみ含める。
7. 必ず有効なJSONのみを出力する（説明文・コードフェンス以外の文章は不要）。`;

    const response = await client.messages.create({
      model: this.defaultModel(),
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
   * 既定モデル（既存 CodeExtractionService と同じ規約に従う）
   */
  private defaultModel(): string {
    return process.env.EXTRACTION_MODEL || 'claude-sonnet-4-6';
  }

  /**
   * イシューツリーのノードに対する「生成AI候補」を構造化出力で生成する。
   * 候補は 3〜6 件。kind は呼び出し側が文脈から決定した expectedKind に統一する。
   */
  async suggestIssueNodes(
    context: IssueNodeSuggestContext,
    apiKey: string,
  ): Promise<IssueNodeSuggestion[]> {
    const client = this.getClient(apiKey);

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
      model: this.defaultModel(),
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: lines.join('\n'),
        },
      ],
      system: systemPrompt,
    });

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
  ): Promise<GeneratedKpiItem[]> {
    const client = this.getClient(apiKey);

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
      model: this.defaultModel(),
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: lines.join('\n'),
        },
      ],
      system: systemPrompt,
    });

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
}

