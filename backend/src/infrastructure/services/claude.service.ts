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
}

/**
 * 生成AIが返すイシューノード候補
 */
export interface IssueNodeSuggestion {
  label: string;
  kind: string;
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
      model: 'claude-sonnet-4-20250514',
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
      model: 'claude-sonnet-4-20250514',
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
      model: 'claude-sonnet-4-20250514',
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
    lines.push('');
    lines.push(
      `上記の対象ノードの子として、kind="${context.expectedKind}"（${context.expectedKindLabel}）の候補を 3〜6 件提案してください。`,
    );

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
}

