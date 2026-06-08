/**
 * issue-tree-patterns.ts — 方法論ツリーの「パターン(テンプレ)」と「ノード種別(kind)」の
 * 表示・振る舞い設定を 1 か所に集約した純粋データ定義。
 *
 * spec: docs/superpowers/specs/2026-06-09-unified-issue-tree-design.md
 *
 * - パターンは「開始テンプレ」。ノード種別は混在可・配置は強制しない（後から変更可）。
 * - kind ごとに ラベル / 色(border/bar/chip) / 追加ボタン / 仕掛け(affordance) を持つ。
 * React には依存しない（アイコンは呼び出し側で対応付ける）。
 */

// ===========================================
// パターン（作成テンプレ）
// ===========================================

export type IssueTreePattern = 'ISSUE_POINT' | 'WHY' | 'WHAT' | 'HOW' | 'MECE_ACTION' | 'KPI';

export const ISSUE_TREE_PATTERNS: IssueTreePattern[] = [
  'ISSUE_POINT',
  'WHY',
  'WHAT',
  'HOW',
  'MECE_ACTION',
  'KPI',
];

/** パターンの開始例（教材『ツリーパターン早見表』準拠）。 */
export type PatternExample = {
  /** ルート（ツリーの問い）の例 */
  rootLabel: string;
  /** ルート直下の子ノードの例（一括挿入もできる開始例） */
  children: string[];
};

export type PatternMeta = {
  label: string;
  sublabel: string;
  description: string;
  /** 何に使う／末端の形／ルールの短文ガイド（教材準拠）。 */
  guide: string;
  /** 開始例（ルート例＋子例）。作成ダイアログ・例挿入で使う。 */
  example: PatternExample;
  accent: string; // 左ボーダー色
  badge: string; // バッジ（border + bg + text）
  ring: string; // 選択時 ring 色
  iconColor: string; // 選択時アイコン色
  cardHover: string; // カード hover ボーダー
  nameExample: string; // ツリー名 placeholder
  rootExample: string; // ルートの問い placeholder
};

export const PATTERN_META: Record<IssueTreePattern, PatternMeta> = {
  ISSUE_POINT: {
    label: 'イシューツリー',
    sublabel: '論点・調査',
    description:
      '課題を論点（疑問形）にMECE分解し、各論点に仮説→検証→検証結果(○×△)。発散→収束で結論を組み立てます。',
    guide:
      '何に使う：「結局どこに問題があるのか」を切り分けるとき。末端の形：論点（疑問形）→仮説→検証→検証結果(○×△)。ルール：子はすべて疑問形でMECE（モレなくダブりなく）に。',
    example: {
      rootLabel: '営業利益率が低下している',
      children: [
        'どの製品・顧客で収益が悪化しているか？',
        'コスト構造のどこが圧迫要因か？',
        '競合との価格・付加価値の差は？',
      ],
    },
    accent: 'border-l-slate-700',
    badge: 'text-slate-700 bg-slate-50 border-slate-200',
    ring: 'ring-slate-300',
    iconColor: 'text-slate-700',
    cardHover: 'hover:border-slate-300',
    nameExample: '営業利益率が低い',
    rootExample: 'なぜ営業利益率が低いのか？（論点に分解する）',
  },
  WHY: {
    label: 'Whyツリー',
    sublabel: '原因究明',
    description: '「なぜ？」を繰り返して問題の根本原因を掘り下げます。○×△で確からしさを記録。',
    guide:
      '何に使う：問題の根本原因を突き止めるとき。末端の形：これ以上「なぜ？」を返せない真因。ルール：1つの結果に対して「なぜ？」で枝分かれし、各原因に○×△で確からしさを付ける。',
    example: {
      rootLabel: '売上が前年比 -10%',
      children: ['なぜ：顧客数が減少（-15%）', 'なぜ：客単価が低下（-3%）'],
    },
    accent: 'border-l-amber-500',
    badge: 'text-amber-700 bg-amber-50 border-amber-200',
    ring: 'ring-amber-300',
    iconColor: 'text-amber-600',
    cardHover: 'hover:border-amber-300',
    nameExample: '売上が前年比-10%',
    rootExample: 'なぜ売上が下がったのか？',
  },
  WHAT: {
    label: 'Whatツリー',
    sublabel: '対象分割',
    description: '対象を構成要素にMECE分解します（売上＝客数×単価 など）。仕掛けなしのシンプル分割。',
    guide:
      '何に使う：業務や対象の全体像を構成要素に分けて把握するとき。末端の形：それ以上分けない構成要素。ルール：足し合わせると元に戻るMECEな分割にする（疑問形にはしない）。',
    example: {
      rootLabel: '購買業務',
      children: ['月次計画発注', '緊急発注', '入荷・検収'],
    },
    accent: 'border-l-gray-400',
    badge: 'text-gray-700 bg-gray-50 border-gray-200',
    ring: 'ring-gray-300',
    iconColor: 'text-gray-600',
    cardHover: 'hover:border-gray-300',
    nameExample: '売上の構成',
    rootExample: '売上は何で構成されるか？',
  },
  HOW: {
    label: 'Howツリー',
    sublabel: '打ち手・発散',
    description: '課題に対する解決候補を発散的に洗い出します。採用／保留／不採用で取捨選択。',
    guide:
      '何に使う：「どうすれば？」の打ち手を幅広く出すとき。末端の形：具体的な打ち手候補。ルール：まず発散で量を出し、各候補を採用／保留／不採用で取捨選択する。',
    example: {
      rootLabel: '在庫予測精度の向上',
      children: ['過去データ活用', 'リアルタイムデータ活用', '人的判断の組み込み'],
    },
    accent: 'border-l-emerald-500',
    badge: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    ring: 'ring-emerald-300',
    iconColor: 'text-emerald-600',
    cardHover: 'hover:border-emerald-300',
    nameExample: '解約率を下げる',
    rootExample: 'どうすれば解約率を下げられるか？',
  },
  MECE_ACTION: {
    label: 'MECEアクションツリー',
    sublabel: '打ち手・網羅',
    description: 'ゴールを「〜のために」で行動にMECE分解します。各行動はタスク化できます。',
    guide:
      '何に使う：ゴール達成のためにやることを網羅するとき。末端の形：実行できる行動（タスク化できる粒度）。ルール：ゴールを「〜のために」で行動にMECE分解し、抜け漏れを防ぐ。',
    example: {
      rootLabel: '営業利益率 6.0% を達成する',
      children: ['（ために）売上を220億に伸ばす', '（ために）コスト率を94%に抑える'],
    },
    accent: 'border-l-emerald-600',
    badge: 'text-emerald-800 bg-emerald-50 border-emerald-300',
    ring: 'ring-emerald-300',
    iconColor: 'text-emerald-700',
    cardHover: 'hover:border-emerald-300',
    nameExample: '受注を増やす',
    rootExample: '受注を増やすために何をするか？',
  },
  KPI: {
    label: 'KPIツリー',
    sublabel: '指標分解',
    description: 'KPI を構成KPI に分解します（KGI→KPI→構成KPI）。各ノードに数値を持たせます。',
    guide:
      '何に使う：目標指標(KGI)を測れる構成KPIに分けて管理するとき。末端の形：日々追える構成KPI（数値を持つ）。ルール：上位KPI＝下位KPIの掛け算・足し算で説明できる形に分解する。',
    example: {
      rootLabel: '営業利益率 6.0%',
      children: ['売上高', 'コスト率'],
    },
    accent: 'border-l-blue-500',
    badge: 'text-blue-700 bg-blue-50 border-blue-200',
    ring: 'ring-blue-300',
    iconColor: 'text-blue-600',
    cardHover: 'hover:border-blue-300',
    nameExample: '営業利益',
    rootExample: '営業利益はどのKPIで構成されるか？',
  },
};

// ===========================================
// ノード種別（kind）
// ===========================================

export type IssueNodeKind =
  | 'ISSUE'
  | 'POINT'
  | 'HYPOTHESIS'
  | 'VERIFICATION'
  | 'RESULT'
  | 'CAUSE'
  | 'COUNTERMEASURE'
  | 'ELEMENT'
  | 'OPTION'
  | 'ACTION'
  | 'METRIC';

export const ISSUE_NODE_KINDS: IssueNodeKind[] = [
  'ISSUE',
  'POINT',
  'HYPOTHESIS',
  'VERIFICATION',
  'RESULT',
  'CAUSE',
  'COUNTERMEASURE',
  'ELEMENT',
  'OPTION',
  'ACTION',
  'METRIC',
];

/**
 * 仕掛け（affordance）。強制しない。
 * - verification: ○CONFIRMED/×REJECTED/△UNKNOWN/?NEEDS_HEARING（CAUSE/POINT/HYPOTHESIS/VERIFICATION/RESULT）
 * - recommendation: 採用/保留/不採用（OPTION/COUNTERMEASURE）
 * - task: タスク化（ACTION）
 * - metric: 数値(metadata.value)（METRIC）
 */
export type KindAffordance = 'verification' | 'recommendation' | 'task' | 'metric' | null;

export type ChildAddButton = {
  label: string;
  childKind: IssueNodeKind;
  /** 既定の新規ラベル（addNode 第3引数） */
  defaultLabel: string;
};

export type KindConfig = {
  label: string;
  /** 種別の流れ説明（編集パネル用） */
  flowLabel: string;
  border: string; // カードボーダー
  bar: string; // ヘッダーバー
  chip: string; // チップ（bg + text）
  affordance: KindAffordance;
  /** このノードを選択したときに出す追加ボタン（パターン非依存の汎用セット） */
  childAddButtons: ChildAddButton[];
};

// 種別ごとの設定。色は spec の指針に従う。
export const KIND_CONFIG: Record<IssueNodeKind, KindConfig> = {
  ISSUE: {
    label: '課題',
    flowLabel: '課題 / ゴール / 対象（出発点）',
    border: 'border-slate-300',
    bar: 'bg-slate-700',
    chip: 'bg-slate-100 text-slate-700',
    affordance: null,
    childAddButtons: [
      { label: '論点を追加', childKind: 'POINT', defaultLabel: '新しい論点' },
      { label: 'なぜ?', childKind: 'CAUSE', defaultLabel: '新しい原因' },
      { label: '打ち手候補', childKind: 'OPTION', defaultLabel: '新しい打ち手候補' },
      { label: '行動', childKind: 'ACTION', defaultLabel: '新しい行動' },
      { label: '構成要素', childKind: 'ELEMENT', defaultLabel: '新しい構成要素' },
      { label: '子KPI', childKind: 'METRIC', defaultLabel: '新しいKPI' },
    ],
  },
  POINT: {
    label: '論点',
    flowLabel: '論点（疑問形・再帰）',
    border: 'border-slate-300',
    bar: 'bg-slate-600',
    chip: 'bg-slate-100 text-slate-700',
    affordance: 'verification',
    childAddButtons: [
      { label: 'サブ論点を追加', childKind: 'POINT', defaultLabel: '新しいサブ論点' },
      { label: '仮説を追加', childKind: 'HYPOTHESIS', defaultLabel: '新しい仮説' },
    ],
  },
  HYPOTHESIS: {
    label: '仮説',
    flowLabel: '仮説',
    border: 'border-purple-300',
    bar: 'bg-purple-600',
    chip: 'bg-purple-50 text-purple-700',
    affordance: 'verification',
    childAddButtons: [
      { label: '検証を追加', childKind: 'VERIFICATION', defaultLabel: '新しい検証アクション' },
    ],
  },
  VERIFICATION: {
    label: '検証',
    flowLabel: '検証アクション',
    border: 'border-cyan-300',
    bar: 'bg-cyan-600',
    chip: 'bg-cyan-50 text-cyan-700',
    affordance: 'verification',
    childAddButtons: [
      { label: '検証結果を追加', childKind: 'RESULT', defaultLabel: '新しい検証結果' },
    ],
  },
  RESULT: {
    label: '検証結果',
    flowLabel: '検証結果（○×△）',
    border: 'border-cyan-400',
    bar: 'bg-cyan-700',
    chip: 'bg-cyan-50 text-cyan-800',
    affordance: 'verification',
    childAddButtons: [],
  },
  CAUSE: {
    label: '原因',
    flowLabel: 'なぜ（原因の深掘り・再帰）',
    border: 'border-amber-300',
    bar: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-700',
    affordance: 'verification',
    childAddButtons: [
      { label: 'さらに なぜ?', childKind: 'CAUSE', defaultLabel: '新しい原因' },
    ],
  },
  COUNTERMEASURE: {
    label: '打ち手',
    flowLabel: '打ち手（対策・OPTION相当）',
    border: 'border-emerald-300',
    bar: 'bg-emerald-600',
    chip: 'bg-emerald-50 text-emerald-700',
    affordance: 'recommendation',
    childAddButtons: [
      { label: '打ち手を追加', childKind: 'COUNTERMEASURE', defaultLabel: '新しい打ち手' },
    ],
  },
  ELEMENT: {
    label: '構成要素',
    flowLabel: '構成要素（対象分割・再帰）',
    border: 'border-gray-300',
    bar: 'bg-gray-500',
    chip: 'bg-gray-100 text-gray-700',
    affordance: null,
    childAddButtons: [
      { label: '構成要素を追加', childKind: 'ELEMENT', defaultLabel: '新しい構成要素' },
    ],
  },
  OPTION: {
    label: '打ち手候補',
    flowLabel: '解決候補（発散・再帰）',
    border: 'border-emerald-300',
    bar: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-700',
    affordance: 'recommendation',
    childAddButtons: [
      { label: '打ち手候補を追加', childKind: 'OPTION', defaultLabel: '新しい打ち手候補' },
    ],
  },
  ACTION: {
    label: '行動',
    flowLabel: '行動（MECE・タスク化・再帰）',
    border: 'border-emerald-400',
    bar: 'bg-emerald-700',
    chip: 'bg-emerald-50 text-emerald-800',
    affordance: 'task',
    childAddButtons: [
      { label: '『ために』行動を追加', childKind: 'ACTION', defaultLabel: '新しい行動' },
    ],
  },
  METRIC: {
    label: 'KPI',
    flowLabel: 'KPI（数値・再帰）',
    border: 'border-blue-300',
    bar: 'bg-blue-600',
    chip: 'bg-blue-50 text-blue-700',
    affordance: 'metric',
    childAddButtons: [{ label: '子KPIを追加', childKind: 'METRIC', defaultLabel: '新しいKPI' }],
  },
};

/**
 * パターンに応じて、ISSUE ルートで「主役にする」追加ボタンの kind 並び（先頭優先）。
 * ISSUE ノードは全種別の子を持てるが、パターンに合うものを上位に出す。
 */
export const ROOT_PRIMARY_KIND: Record<IssueTreePattern, IssueNodeKind[]> = {
  ISSUE_POINT: ['POINT', 'CAUSE', 'OPTION'],
  WHY: ['CAUSE', 'POINT', 'OPTION'],
  WHAT: ['ELEMENT', 'POINT'],
  HOW: ['OPTION', 'ACTION', 'POINT'],
  MECE_ACTION: ['ACTION', 'OPTION', 'POINT'],
  KPI: ['METRIC', 'ELEMENT'],
};

/** ルートノードの kind（バックエンドの rootKindForPattern と整合: KPI→METRIC、他→ISSUE）。 */
export function rootKindForPattern(pattern: IssueTreePattern): IssueNodeKind {
  return pattern === 'KPI' ? 'METRIC' : 'ISSUE';
}

/** 旧 type(WHY/SOLUTION) → pattern フォールバック。 */
export function patternFromLegacyType(type?: 'WHY' | 'SOLUTION'): IssueTreePattern {
  return type === 'SOLUTION' ? 'HOW' : 'WHY';
}

/** pattern → 発想法ダイアログ用の旧 treeType。打ち手系は SOLUTION、それ以外は WHY。 */
export function legacyTreeTypeForPattern(pattern: IssueTreePattern): 'WHY' | 'SOLUTION' {
  return pattern === 'HOW' || pattern === 'MECE_ACTION' ? 'SOLUTION' : 'WHY';
}

/**
 * パターンと対象ノードの種別から「子候補・例挿入の既定 kind」を決める。
 * バックエンドの decideSuggestKind（issue-tree.controller.ts）とミラー:
 * - 対象が HYPOTHESIS/VERIFICATION → VERIFICATION（検証候補）
 * - 対象が CAUSE → CAUSE（なぜ候補）
 * - WHY → CAUSE / HOW → OPTION / MECE_ACTION → ACTION / WHAT → ELEMENT /
 *   KPI → METRIC / ISSUE_POINT → POINT
 * targetKind 省略時はルート（パターン既定）として解決する。
 */
export function childKindForPattern(
  pattern: IssueTreePattern,
  targetKind?: IssueNodeKind,
): IssueNodeKind {
  if (targetKind === 'HYPOTHESIS' || targetKind === 'VERIFICATION') return 'VERIFICATION';
  if (targetKind === 'CAUSE') return 'CAUSE';
  switch (pattern) {
    case 'WHY':
      return 'CAUSE';
    case 'HOW':
      return 'OPTION';
    case 'MECE_ACTION':
      return 'ACTION';
    case 'WHAT':
      return 'ELEMENT';
    case 'KPI':
      return 'METRIC';
    case 'ISSUE_POINT':
    default:
      return 'POINT';
  }
}

// ===========================================
// 発散→収束ロールアップ（spec C, イシューツリー）
// ===========================================
//
// 配下の RESULT(検証結果) の verification(○×△) を上位ノードへ集約してバッジを作る。
// React に依存しない純粋ロジック（テスト可能）。ページ側 computeRollups から使う。

export type RollupVerification = 'CONFIRMED' | 'REJECTED' | 'UNKNOWN' | 'NEEDS_HEARING' | 'NA';

export type RollupStatus = 'confirmed' | 'rejected' | 'partial' | 'none';

export type RollupCounts = {
  total: number;
  confirmed: number;
  rejected: number;
  unknown: number;
};

export function emptyRollupCounts(): RollupCounts {
  return { total: 0, confirmed: 0, rejected: 0, unknown: 0 };
}

/** 検証結果1件を集計に加える（NA は集計対象外）。 */
export function addVerificationToCounts(acc: RollupCounts, v: RollupVerification): RollupCounts {
  if (v === 'NA') return acc;
  const next = { ...acc, total: acc.total + 1 };
  if (v === 'CONFIRMED') next.confirmed += 1;
  else if (v === 'REJECTED') next.rejected += 1;
  else next.unknown += 1; // UNKNOWN / NEEDS_HEARING は「未確定」
  return next;
}

/**
 * 集計結果から全体ステータスを決める。
 *   rejected(×あり) > partial(△/?あり) > confirmed(残り全て○・1件以上) > none(対象なし)
 */
export function rollupStatus(acc: RollupCounts): RollupStatus {
  if (acc.total === 0) return 'none';
  if (acc.rejected > 0) return 'rejected';
  if (acc.unknown > 0) return 'partial';
  return 'confirmed';
}
