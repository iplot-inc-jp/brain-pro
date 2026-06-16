'use client';

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  memo,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Panel,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  MarkerType,
  getSmoothStepPath,
  getBezierPath,
  useNodesState,
  useReactFlow,
  SelectionMode,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  ChevronLeft,
  Loader2,
  Pencil,
  AlertCircle,
  Plus,
  Trash2,
  X,
  FileText,
  HelpCircle,
  Lightbulb,
  Target,
  RefreshCw,
  Sparkles,
  ListChecks,
  Search,
  ExternalLink,
  Unlink,
  Spline,
  Waypoints,
  LayoutGrid,
  ClipboardCheck,
  Boxes,
  BarChart3,
  CheckCircle2,
  MoreHorizontal,
  Wand2,
  ListPlus,
  Minimize2,
  Maximize2,
} from 'lucide-react';
import {
  parseIssueMarkdown,
  flattenIssueTree,
  type Verification,
  type Recommendation,
} from '@/lib/issue-markdown';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { ManualButton } from '@/components/ui/manual-dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { AiSuggestDialog } from '@/components/issue-trees/ai-suggest-dialog';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useReadOnly } from '@/components/read-only-context';
import { ExportImportButton } from '@/components/io/ExportImportButton';
import { entityJsonIo, type EntityBundle } from '@/lib/io';
import { IdeationAssistDialog } from '@/components/issue-trees/ideation-assist-dialog';
import {
  tasksApi,
  taskStatusLabels,
  type Task,
  type TasksResponse,
  API_URL as TASKS_API_URL,
} from '@/lib/tasks';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

// ===========================================
// 型
// ===========================================

import {
  KIND_CONFIG,
  PATTERN_META,
  ISSUE_NODE_KINDS,
  ROOT_PRIMARY_KIND,
  rootKindForPattern,
  allowedChildKinds,
  rootAllowedKinds,
  childKindForPattern,
  patternFromLegacyType,
  legacyTreeTypeForPattern,
  emptyRollupCounts,
  addVerificationToCounts,
  rollupStatus,
  computeDimmedNodeIds,
  type IssueNodeKind,
  type IssueTreePattern,
  type ChildAddButton,
  type RollupStatus,
  type RollupVerification,
} from '@/lib/issue-tree-patterns';

type BackendNode = {
  id: string;
  treeId: string;
  parentId: string | null;
  depth: number;
  order: number;
  label: string;
  kind: IssueNodeKind;
  verification: Verification;
  recommendation: Recommendation;
  evidence: string | null;
  rootCauseNodeId: string | null;
  metadata: Record<string, unknown> | null;
};

type IssueTree = {
  id: string;
  projectId: string;
  pattern?: IssueTreePattern;
  type?: 'WHY' | 'SOLUTION';
  name: string;
  rootQuestion: string | null;
  nodes: BackendNode[];
};

/** 配下 RESULT の集約判定（収束ロールアップ）。 */
type Rollup = {
  total: number;
  confirmed: number;
  rejected: number;
  unknown: number;
  /** 全体の状態: 'confirmed'(全○) / 'rejected'(×あり) / 'partial'(△等あり) / 'none'(集計対象なし) */
  status: RollupStatus;
};

// React Flow ノードに載せるデータ
type MindNodeData = {
  node: BackendNode | null; // null = ルートの問い（仮想ノード）
  isRoot: boolean;
  rootQuestion: string;
  pattern: IssueTreePattern;
  selected: boolean;
  taskCount: number;
  /**
   * 打ち手の「採用」連動グレーアウト。
   * 同じ親配下の打ち手系兄弟（OPTION/COUNTERMEASURE）に ADOPT(採用) が1つでもあるとき、
   * 自身が ADOPT でない打ち手系ノードは true（淡色＝選ばれていない／不採用扱い）。
   * ルート・非打ち手ノードは常に false。
   */
  dimmed: boolean;
  /** verification 集約バッジ（POINT/ISSUE 等の収束表示用。無ければ null） */
  rollup: Rollup | null;
  onSelect: (id: string | null) => void;
  onAddChild: (parentId: string | null, kind: IssueNodeKind, label: string) => void;
  onIdeate: (id: string | null) => void;
  /** AIで候補生成（生成AIアシスト） */
  onAiSuggest: (id: string | null) => void;
  /** このパターンの開始例（example.children）を子として一括挿入 */
  onInsertExample: (id: string | null) => void;
  onDelete: (id: string) => void;
};

const ROOT_ID = '__root__';

// ===========================================
// kind / verification / recommendation の表示メタ
// ===========================================

type TaskFlavor = { verb: string; titlePrefix: string; chip: string; icon: typeof Search };

// タスク化できる種別の「タスク観点」メタ。
// CAUSE（なぜ）/VERIFICATION → 調査タスク（amber）、ACTION/COUNTERMEASURE/OPTION → 実行タスク（blue）。
const INVESTIGATE_FLAVOR: TaskFlavor = {
  verb: '調査タスクを作成',
  titlePrefix: '調査',
  chip: 'bg-amber-50 text-amber-700 border-amber-200',
  icon: Search,
};
const EXECUTE_FLAVOR: TaskFlavor = {
  verb: '実行タスクを作成',
  titlePrefix: '実行',
  chip: 'bg-blue-50 text-blue-700 border-blue-200',
  icon: ListChecks,
};
const KIND_TASK_FLAVOR: Partial<Record<IssueNodeKind, TaskFlavor>> = {
  CAUSE: INVESTIGATE_FLAVOR,
  VERIFICATION: INVESTIGATE_FLAVOR,
  COUNTERMEASURE: EXECUTE_FLAVOR,
  OPTION: EXECUTE_FLAVOR,
  ACTION: EXECUTE_FLAVOR,
};

// 種別ごとのアイコン。
const KIND_ICON: Record<IssueNodeKind, typeof HelpCircle> = {
  ISSUE: HelpCircle,
  POINT: Search,
  HYPOTHESIS: Lightbulb,
  VERIFICATION: ListChecks,
  RESULT: ClipboardCheck,
  CAUSE: Lightbulb,
  COUNTERMEASURE: Target,
  ELEMENT: Boxes,
  OPTION: Lightbulb,
  ACTION: ListChecks,
  METRIC: BarChart3,
};

const VERIFY_META: Record<Verification, { label: string; cls: string }> = {
  CONFIRMED: { label: '○ 確定', cls: 'border-green-300 bg-green-50 text-green-700' },
  REJECTED: { label: '× 否定', cls: 'border-red-300 bg-red-50 text-red-700' },
  UNKNOWN: { label: '△ 未確認', cls: 'border-gray-300 bg-gray-100 text-gray-600' },
  NEEDS_HEARING: { label: '? 要ヒアリング', cls: 'border-amber-300 bg-amber-50 text-amber-700' },
  NA: { label: '—', cls: 'border-gray-200 bg-gray-50 text-gray-400' },
};

const RECO_META: Record<Recommendation, { label: string; cls: string }> = {
  ADOPT: { label: '採用', cls: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  HOLD: { label: '保留', cls: 'border-amber-300 bg-amber-50 text-amber-700' },
  REJECT: { label: '不採用', cls: 'border-red-300 bg-red-50 text-red-700' },
  NA: { label: '—', cls: 'border-gray-200 bg-gray-50 text-gray-400' },
};

const VERIFY_OPTIONS: Verification[] = [
  'CONFIRMED',
  'REJECTED',
  'UNKNOWN',
  'NEEDS_HEARING',
  'NA',
];
const RECO_OPTIONS: Recommendation[] = ['ADOPT', 'HOLD', 'REJECT', 'NA'];
// 種別変更セレクト: 全 kind（取り違え救済）。配置の強制バリデーションはしない。
const KIND_OPTIONS: IssueNodeKind[] = ISSUE_NODE_KINDS;

// ===========================================
// レイアウト計算（外部依存なし・決定的 左→右 ツリー）
// ===========================================

const NODE_W = 220;
const NODE_H = 84;
const X_GAP = 300; // depth ごとの水平間隔（広めにして子の差し込みでも重ならない）
// 葉ノードの行送り。実際のマインドマップカードは複数行ラベル＋追加/他/AI候補/例/発想法/削除ボタンで
// 概ね 140〜170px の高さになるため、旧 NODE_H(84)+Y_GAP(24)=108 では一括追加時に縦で重なる。
// 葉は MIND_ROW_H ずつ送ることでカード実高に足りる縦間隔を確保する。
const MIND_ROW_H = 170;

// 「距離を空ける/狭める」の間隔係数の範囲。X_GAP / MIND_ROW_H に乗算する。
const SPACING_MIN = 0.6;
const SPACING_MAX = 1.8;
const SPACING_STEP = 0.2;
const SPACING_DEFAULT = 1.0;
const clampSpacing = (s: number) =>
  Math.min(SPACING_MAX, Math.max(SPACING_MIN, Math.round(s * 100) / 100));

/**
 * 親→子の隣接から再帰的に座標を求める。
 * x = depth * X_GAP、y は部分木の高さに応じて子を縦に広げ、親はその中央に置く。
 * spacing（間隔係数, 既定1.0）を X_GAP / MIND_ROW_H に乗算して全体の粗密を調整する。
 */
function computeLayout(
  rootId: string,
  childrenMap: Map<string, string[]>,
  spacing = 1,
): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const xGap = X_GAP * spacing;
  const rowH = MIND_ROW_H * spacing;
  let cursorY = 0;

  const place = (id: string, depth: number): number => {
    const children = childrenMap.get(id) ?? [];
    const x = depth * xGap;

    if (children.length === 0) {
      const y = cursorY;
      cursorY += rowH;
      pos.set(id, { x, y });
      return y;
    }

    const childYs = children.map((cid) => place(cid, depth + 1));
    const y = (childYs[0] + childYs[childYs.length - 1]) / 2;
    pos.set(id, { x, y });
    return y;
  };

  place(rootId, 0);
  return pos;
}

// ===========================================
// 発散→収束ロールアップ（spec C, イシューツリー）
// ===========================================
//
// 配下の RESULT（検証結果ノード）の verification(○×△) を上位ノードへ集約して
// バッジを作る。RESULT 自身の verification を「葉の判定」とし、子のロールアップを
// 足し上げる（多重ネスト・論点の再帰に対応）。クライアント集計のみ・永続化しない。
//   status: rejected(×あり) > partial(△/?あり) > confirmed(残り全て○・1件以上) > none(集計対象なし)

function computeRollups(
  backendNodes: BackendNode[],
  childrenMap: Map<string, string[]>,
  nodeById: Map<string, BackendNode>,
): Map<string, Rollup> {
  const memo = new Map<string, Rollup>();

  const walk = (id: string): Rollup => {
    if (memo.has(id)) return memo.get(id)!;
    let acc = emptyRollupCounts();
    const node = id === ROOT_ID ? null : nodeById.get(id);

    // 自身が RESULT なら、自身の verification を 1 件としてカウント。
    if (node && node.kind === 'RESULT') {
      acc = addVerificationToCounts(acc, (node.verification ?? 'NA') as RollupVerification);
    }

    for (const childId of childrenMap.get(id) ?? []) {
      const cr = walk(childId);
      acc.total += cr.total;
      acc.confirmed += cr.confirmed;
      acc.rejected += cr.rejected;
      acc.unknown += cr.unknown;
    }

    const result: Rollup = { ...acc, status: rollupStatus(acc) };
    memo.set(id, result);
    return result;
  };

  // 全ノードを確実に埋める。仮想ルートを使う場合のみ ROOT_ID も埋める
  // （実ルート起点では childrenMap に ROOT_ID キーが無いので埋めなくてよい）。
  if (childrenMap.has(ROOT_ID)) walk(ROOT_ID);
  for (const n of backendNodes) walk(n.id);
  return memo;
}

// ===========================================
// カスタムノード
// ===========================================

/**
 * ノード kind と pattern から「種別連動の追加ボタン」を決める（spec D）。
 * ISSUE ルートはパターンに合う主要 kind を上位に出しつつ全種別を提供。
 * それ以外は KIND_CONFIG.childAddButtons（種別連動・再帰）をそのまま使う。
 */
function addButtonsFor(kind: IssueNodeKind, pattern: IssueTreePattern): ChildAddButton[] {
  if (kind !== 'ISSUE') return KIND_CONFIG[kind].childAddButtons;
  const base = KIND_CONFIG.ISSUE.childAddButtons;
  const primary = ROOT_PRIMARY_KIND[pattern];
  // primary 指定の順に並べ替え、残りを後ろに。
  const rank = (k: IssueNodeKind) => {
    const i = primary.indexOf(k);
    return i === -1 ? primary.length + 1 : i;
  };
  return [...base].sort((a, b) => rank(a.childKind) - rank(b.childKind));
}

/** 収束ロールアップの集約バッジ表示メタ。 */
const ROLLUP_META: Record<
  Rollup['status'],
  { label: string; cls: string } | null
> = {
  confirmed: { label: '✓ 検証済', cls: 'border-green-300 bg-green-50 text-green-700' },
  rejected: { label: '× 要再検討', cls: 'border-red-300 bg-red-50 text-red-700' },
  partial: { label: '△ 検証中', cls: 'border-amber-300 bg-amber-50 text-amber-700' },
  none: null,
};

/**
 * ノードの追加ボタン群（spec D/E/F）。
 * - 先頭3件は種別連動チップ。残りの種別連動ボタン＋全 childKind は「他」オーバーフローへ。
 * - 「AI候補」「例を挿入」「発想法」を併設。
 * nodeId は対象（親）ノードID。ルートの問いは null。
 */
function NodeAddControls({
  nodeId,
  pattern,
  buttons,
  onAddChild,
  onAiSuggest,
  onInsertExample,
  onIdeate,
}: {
  nodeId: string | null;
  pattern: IssueTreePattern;
  buttons: ChildAddButton[];
  onAddChild: (parentId: string | null, kind: IssueNodeKind, label: string) => void;
  onAiSuggest: (id: string | null) => void;
  onInsertExample: (id: string | null) => void;
  onIdeate: (id: string | null) => void;
}) {
  const primary = buttons.slice(0, 3);
  const overflowConfigured = buttons.slice(3);
  // 「他」: 設定済みの残りボタン + 設定に出ていない全 childKind（救済・自由配置）。
  const shownKinds = new Set(buttons.map((b) => b.childKind));
  const extraKinds = ISSUE_NODE_KINDS.filter((k) => !shownKinds.has(k));
  const hasOverflow = overflowConfigured.length > 0 || extraKinds.length > 0;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {primary.map((b) => (
        <button
          key={b.childKind + b.label}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAddChild(nodeId, b.childKind, b.defaultLabel);
          }}
          className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] hover:brightness-95 ${KIND_CONFIG[b.childKind].chip} border-transparent`}
          title={b.label}
        >
          <Plus className="h-3 w-3" />
          {b.label}
        </button>
      ))}

      {/* 他: 残り全 childKind を追加できるオーバーフローメニュー（F） */}
      {hasOverflow && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className="nodrag nopan inline-flex items-center gap-0.5 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-100"
              title="他の種別の子ノードを追加"
            >
              <MoreHorizontal className="h-3 w-3" />他
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            {overflowConfigured.length > 0 && (
              <>
                <DropdownMenuLabel className="text-[11px] text-gray-500">
                  このノードの定番
                </DropdownMenuLabel>
                {overflowConfigured.map((b) => {
                  const Icon = KIND_ICON[b.childKind];
                  return (
                    <DropdownMenuItem
                      key={b.childKind + b.label}
                      onSelect={() => onAddChild(nodeId, b.childKind, b.defaultLabel)}
                      className="gap-2 text-xs"
                    >
                      <Icon className="h-3.5 w-3.5 text-gray-500" />
                      {b.label}
                    </DropdownMenuItem>
                  );
                })}
                {extraKinds.length > 0 && <DropdownMenuSeparator />}
              </>
            )}
            {extraKinds.length > 0 && (
              <>
                <DropdownMenuLabel className="text-[11px] text-gray-500">
                  他の種別で追加（自由配置）
                </DropdownMenuLabel>
                {extraKinds.map((k) => {
                  const kc = KIND_CONFIG[k];
                  const Icon = KIND_ICON[k];
                  return (
                    <DropdownMenuItem
                      key={k}
                      onSelect={() => onAddChild(nodeId, k, `新しい${kc.label}`)}
                      className="gap-2 text-xs"
                    >
                      <Icon className="h-3.5 w-3.5 text-gray-500" />
                      {kc.label}を追加
                    </DropdownMenuItem>
                  );
                })}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* AIで候補生成（D）。生成AIは対象ノードが必要なため、ルートの問い(null)では出さない。 */}
      {nodeId !== null && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAiSuggest(nodeId);
          }}
          className="inline-flex items-center gap-0.5 rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700 hover:bg-violet-100"
          title="AIで子ノード候補を生成"
        >
          <Wand2 className="h-3 w-3" />
          AI候補
        </button>
      )}

      {/* 例を挿入（E） */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onInsertExample(nodeId);
        }}
        className="inline-flex items-center gap-0.5 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 hover:bg-amber-100"
        title={`このパターンの開始例を子ノードに追加（${PATTERN_META[pattern].example.children.length}件）`}
      >
        <ListPlus className="h-3 w-3" />
        例を挿入
      </button>

      {/* 発想法 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onIdeate(nodeId);
        }}
        className="inline-flex items-center gap-0.5 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700 hover:bg-blue-100"
        title="発想法で子ノードに分解"
      >
        <Sparkles className="h-3 w-3" />
        発想法
      </button>
    </div>
  );
}

const MindNode = memo(function MindNode({ data }: NodeProps) {
  const d = data as unknown as MindNodeData;
  const { node, isRoot, pattern, selected } = d;

  if (isRoot) {
    const rootKind = rootKindForPattern(pattern);
    const buttons = addButtonsFor(rootKind, pattern);
    const rollupMeta = d.rollup ? ROLLUP_META[d.rollup.status] : null;
    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          d.onSelect(null);
        }}
        className={`relative w-[220px] cursor-pointer rounded-lg border-2 bg-white px-3 py-2.5 shadow-sm transition ${
          selected ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-indigo-300'
        }`}
      >
        <Handle type="source" position={Position.Right} className="!bg-indigo-400" />
        <div className="mb-1 flex items-center justify-between gap-1">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold text-indigo-600">
            <HelpCircle className="h-3 w-3" />
            ルートの問い
          </span>
          {rollupMeta && (
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${rollupMeta.cls}`}
              title={`配下の検証結果 ${d.rollup!.confirmed}/${d.rollup!.total} ○`}
            >
              {rollupMeta.label}
            </span>
          )}
        </div>
        <div className="text-sm font-bold leading-snug text-gray-900 break-words">
          {d.rootQuestion || '（問い未設定）'}
        </div>
        <NodeAddControls
          nodeId={null}
          pattern={pattern}
          buttons={buttons}
          onAddChild={d.onAddChild}
          onAiSuggest={d.onAiSuggest}
          onInsertExample={d.onInsertExample}
          onIdeate={d.onIdeate}
        />
      </div>
    );
  }

  if (!node) return null;

  const kind: IssueNodeKind = node.kind ?? 'ISSUE';
  const cfg = KIND_CONFIG[kind];
  const Icon = KIND_ICON[kind];
  const showVerify = cfg.affordance === 'verification';
  const showReco = cfg.affordance === 'recommendation';
  const showMetric =
    cfg.affordance === 'metric' &&
    node.metadata != null &&
    node.metadata.value != null &&
    `${node.metadata.value}`.trim() !== '';
  const flavor = KIND_TASK_FLAVOR[kind];
  const TaskIcon = flavor?.icon ?? ListChecks;
  const buttons = addButtonsFor(kind, pattern);
  const rollupMeta = d.rollup ? ROLLUP_META[d.rollup.status] : null;
  // 打ち手の「採用」連動グレーアウト: 同親配下に採用された打ち手があり、
  // 自身が採用でない打ち手系のとき淡色にする（opacity 低下＋彩度を落とす）。
  // 選択中は判別しやすいよう少しだけ復帰させる（選択枠・種別色は保持）。
  const dimmed = d.dimmed;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        d.onSelect(node.id);
      }}
      title={dimmed ? '採用された打ち手があるため不採用扱い（淡色表示）' : undefined}
      className={`relative w-[220px] cursor-pointer rounded-lg border-2 bg-white shadow-sm transition ${
        selected ? 'border-indigo-500 ring-2 ring-indigo-200' : cfg.border
      } ${dimmed ? (selected ? 'opacity-80 grayscale-[60%]' : 'opacity-50 grayscale') : ''}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-gray-300" />
      <Handle type="source" position={Position.Right} className="!bg-gray-300" />
      <div className={`h-1.5 w-full rounded-t-md ${cfg.bar}`} />
      <div className="px-3 py-2">
        <div className="mb-1 flex items-center justify-between gap-1">
          <span
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${cfg.chip}`}
          >
            <Icon className="h-3 w-3" />
            {cfg.label}
          </span>
          {showVerify && (
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${VERIFY_META[node.verification ?? 'NA'].cls}`}
            >
              {VERIFY_META[node.verification ?? 'NA'].label}
            </span>
          )}
          {showReco && (
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${RECO_META[node.recommendation ?? 'NA'].cls}`}
            >
              {RECO_META[node.recommendation ?? 'NA'].label}
            </span>
          )}
          {showMetric && (
            <span className="rounded border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-blue-700">
              {`${node.metadata!.value}`}
            </span>
          )}
        </div>
        <div className="text-sm font-medium leading-snug text-gray-900 break-words">
          {node.label || <span className="text-gray-300">（空）</span>}
        </div>
        {node.evidence && (
          <p className="mt-1 line-clamp-2 text-[11px] text-gray-400">根拠: {node.evidence}</p>
        )}
        {/* 収束ロールアップ: 配下 RESULT の集約（POINT/ISSUE など、自身が RESULT でない時のみ） */}
        {rollupMeta && kind !== 'RESULT' && (
          <div
            className={`mt-1.5 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${rollupMeta.cls}`}
            title={`配下の検証結果 ${d.rollup!.confirmed}/${d.rollup!.total} ○・${d.rollup!.rejected} ×`}
          >
            <CheckCircle2 className="h-3 w-3" />
            {rollupMeta.label}（{d.rollup!.confirmed}/{d.rollup!.total}）
          </div>
        )}
        {d.taskCount > 0 && flavor && (
          <div
            className={`mt-1.5 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${flavor.chip}`}
            title={`${flavor.titlePrefix}タスク ${d.taskCount}件`}
          >
            <TaskIcon className="h-3 w-3" />
            {flavor.titlePrefix}タスク {d.taskCount}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-1">
          <NodeAddControls
            nodeId={node.id}
            pattern={pattern}
            buttons={buttons}
            onAddChild={d.onAddChild}
            onAiSuggest={d.onAiSuggest}
            onInsertExample={d.onInsertExample}
            onIdeate={d.onIdeate}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              d.onDelete(node.id);
            }}
            className="mt-2 inline-flex items-center gap-0.5 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-100"
            title="このノードを削除"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
});

const nodeTypes = { mind: MindNode };

// ===========================================
// カスタムエッジ（親→子の構造リンク）
// ===========================================
//
// イシューツリーのエッジは「親→子」の構造リンクなので、Swimlane の
// EditableEdge のような自由な付け替え・ラベル編集はあえて持たせない。
// ここで足すのは編集に効く最小限だけ:
//   1) 線のどこをクリックしても選択できる（interactionWidth を広く取る）
//   2) 選択中のエッジは「親リンクを外す（＝子ノードをルート直下へ）」操作を出す。
//      これは既存の PUT /nodes/:nodeId { parentId: null } を再利用する非破壊操作で、
//      ノードや配下のサブツリーは削除しない（“切り離し”であって“削除”ではない）。
//   3) 線の形（角ばり smoothstep / 曲線 bezier）は親側の状態でセッション内トグル。
//      永続化フィールドが無いためサーバ保存はしない（見た目のみ）。
//   4) 選択中は子端（子ノード側）に先端アンカーを出す（Swimlane 67e8267 の
//      onTargetAnchorDown をミラー）。アンカーを「何もない所」へドラッグ(=6px超移動)
//      して離すと子ノードをデタッチ（親リンク解除＝ルート直下へ）。上記(2)と同じ
//      既存の PUT { parentId: null } を再利用する非破壊操作で、ノード削除はしない。
//      ※「別ノードへドロップで付け替え」は意図的に未対応。reparent API には
//        直接の自己親チェックしか無く（子孫への付け替えで循環が作れてしまう）、
//        任意ノードへの付け替えは循環リスクがあるため、ここでは空所デタッチのみ。
//      ※ ルート仮想エッジ（parentId=null）は既に親が無いのでアンカーを出さない。

type IssueEdgeShape = 'smoothstep' | 'bezier';

type IssueEdgeData = {
  shape: IssueEdgeShape;
  /** 親リンクを外せるか（ルート直下のエッジは既に親なしなので不可）。 */
  detachable: boolean;
  /** 親リンクを外す（子ノードをルート直下へ移す＝デタッチ）。 */
  onDetach?: (childNodeId: string) => void;
  /** このエッジが指す子ノードID（デタッチ対象）。 */
  childNodeId: string;
};

const IssueEdge = memo(function IssueEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected,
  data,
}: EdgeProps) {
  const d = data as unknown as IssueEdgeData;
  const params = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
  const [edgePath, labelX, labelY] =
    d.shape === 'bezier' ? getBezierPath(params) : getSmoothStepPath(params);

  // 先端ドラッグ（デタッチ）用: 開始点(screen)とカーソル位置を保持してゴースト線を描く。
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

  const onDetach = d.onDetach;
  const childNodeId = d.childNodeId;

  // 子端アンカーのドラッグ（Swimlane 67e8267 の onTargetAnchorDown をミラー）。
  // 6px 超の移動で離した時、ドロップ先が「ノードでない（何もない所）」なら子をデタッチ。
  // ※ 付け替え（別ノードへドロップ）は循環リスクのため未対応。ノード上に落ちた場合は何もしない。
  const onAnchorDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!onDetach) return;
      e.stopPropagation();
      e.preventDefault();
      const sx = e.clientX;
      const sy = e.clientY;
      let moved = false;
      dragStartRef.current = { x: sx, y: sy };
      setDragPos({ x: sx, y: sy });
      const move = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) >= 6) moved = true;
        setDragPos({ x: ev.clientX, y: ev.clientY });
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setDragPos(null);
        dragStartRef.current = null;
        if (!moved) return; // ただのクリックは無視（誤デタッチ防止）
        const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
        const nodeEl = el?.closest('.react-flow__node') as HTMLElement | null;
        // ノードでない所（＝何もない所）に落ちたらデタッチ。ノード上は循環回避のため何もしない。
        if (!nodeEl) onDetach?.(childNodeId);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [onDetach, childNodeId],
  );

  const dragging = dragPos !== null;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        // 線が細くても掴みやすいよう、クリック判定の帯を広く取る（線のどこでも選択可能に）。
        interactionWidth={28}
        style={{
          strokeWidth: selected ? 2.5 : 1.5,
          stroke: selected ? '#6366f1' : '#cbd5e1',
        }}
      />
      <EdgeLabelRenderer>
        {/* 選択中のみ「親リンクを外す」ボタンをパス中点に出す。
            ルート直下エッジ（detachable=false）は親が無いので出さない。 */}
        {selected && d.detachable && d.onDetach && (
          <button
            type="button"
            title="親リンクを外す（このノードをルート直下へ移動）"
            onClick={(e) => {
              e.stopPropagation();
              d.onDetach?.(d.childNodeId);
            }}
            style={{
              position: 'absolute',
              transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan flex h-5 w-5 items-center justify-center rounded-full border border-indigo-400 bg-white text-indigo-600 shadow-sm transition-all hover:scale-110 hover:bg-indigo-50"
          >
            <Unlink className="h-3 w-3" />
          </button>
        )}
        {/* 子端（子ノード側）の先端アンカー。選択中＆デタッチ可能なエッジだけに出す。
            ドラッグで「何もない所」へ離すと子をデタッチ（親リンク解除）。 */}
        {selected && d.detachable && d.onDetach && (
          <div
            className={`nodrag nopan flex items-center justify-center ${
              dragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
            title="ドラッグして何もない所で離す: このノードを親から切り離す"
            onPointerDown={onAnchorDown}
            style={{
              position: 'absolute',
              transform: `translate(-50%,-50%) translate(${targetX}px,${targetY}px)`,
              pointerEvents: 'all',
              width: 22,
              height: 22,
            }}
          >
            <span
              className={`block rounded-full ring-2 transition-all ${
                dragging
                  ? 'h-3.5 w-3.5 bg-indigo-500 ring-indigo-300'
                  : 'h-3 w-3 bg-indigo-500/80 ring-indigo-200'
              }`}
            />
          </div>
        )}
      </EdgeLabelRenderer>
      {/* ドラッグ中のゴースト線（デタッチ操作の視覚フィードバック）。最前面・イベント透過。 */}
      {dragging &&
        dragStartRef.current &&
        dragPos &&
        createPortal(
          <svg
            style={{
              position: 'fixed',
              inset: 0,
              width: '100vw',
              height: '100vh',
              pointerEvents: 'none',
              zIndex: 9999,
            }}
          >
            <line
              x1={dragStartRef.current.x}
              y1={dragStartRef.current.y}
              x2={dragPos.x}
              y2={dragPos.y}
              stroke="#6366f1"
              strokeWidth={2}
              strokeDasharray="5 4"
            />
            <circle cx={dragPos.x} cy={dragPos.y} r={5} fill="#6366f1" />
          </svg>,
          document.body,
        )}
    </>
  );
});

const edgeTypes = { issue: IssueEdge };

// ===========================================
// ページ
// ===========================================

function IssueTreeMindMap() {
  const params = useParams();
  const projectId = params.projectId as string;
  const treeId = params.treeId as string;
  const { canEdit } = useReadOnly();

  const [tree, setTree] = useState<IssueTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [editingName, setEditingName] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // 全画面トグル: ON のときキャンバスのラッパを fixed inset-0 z-50 に拡大して
  // React Flow を画面いっぱいにする。Esc / ボタン再押下で解除。
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 選択中のエッジ（親→子リンク）。Delete でデタッチ、選択中は外すボタンを出す。
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  // 線の形（角ばり / 曲線）。ツリーごとに localStorage 永続化（flow の向き永続化と同様）。
  const [edgeShape, setEdgeShape] = useState<IssueEdgeShape>('smoothstep');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const v = window.localStorage.getItem('issue-tree-edge-shape-' + treeId);
    if (v === 'bezier' || v === 'smoothstep') setEdgeShape(v);
  }, [treeId]);
  const changeEdgeShape = useCallback(
    (s: IssueEdgeShape) => {
      setEdgeShape(s);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('issue-tree-edge-shape-' + treeId, s);
      }
    },
    [treeId],
  );
  // レイアウトの間隔係数（「広げる/狭める」）。X_GAP / MIND_ROW_H に乗算。既定1.0。
  // 永続化フィールドが無いためセッション内のみ。変更すると computeLayout を再適用する。
  const [spacing, setSpacing] = useState<number>(SPACING_DEFAULT);

  // 取り込みダイアログ
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // 発想法アシスト（分解）ダイアログ
  const [ideateOpen, setIdeateOpen] = useState(false);
  const [ideateParentId, setIdeateParentId] = useState<string | null>(null);

  // 生成AI候補ダイアログ
  const [aiSuggestOpen, setAiSuggestOpen] = useState(false);
  const [aiSuggestParentId, setAiSuggestParentId] = useState<string | null>(null);

  // このツリーに紐づくGAP（あれば上部に文脈表示）
  const [linkedGap, setLinkedGap] = useState<{
    businessArea: string;
    gapDescription: string | null;
  } | null>(null);

  // ノードに紐づくタスク（nodeId -> Task[]）。カードのカウントバッジと右パネルの一覧で使う。
  const [tasksByNode, setTasksByNode] = useState<Record<string, Task[]>>({});
  const [creatingTaskNodeId, setCreatingTaskNodeId] = useState<string | null>(null);

  const howToRef = useRef<HTMLDivElement>(null);

  // 全画面トグル時に React Flow を再フィットさせる（拡大/縮小でビューポートが変わるため）。
  const { fitView } = useReactFlow();
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => {
      const next = !prev;
      // ラッパのサイズ確定後に fitView。RAF 2 段でレイアウト反映を待つ。
      requestAnimationFrame(() =>
        requestAnimationFrame(() => fitView({ padding: 0.2 })),
      );
      return next;
    });
  }, [fitView]);

  // Esc で全画面を解除。
  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsFullscreen(false);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => fitView({ padding: 0.2 })),
        );
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen, fitView]);

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem('accessToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  const fetchTree = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/issue-trees/${treeId}`, { headers: getHeaders() });
      if (!res.ok) throw new Error('イシューツリーの取得に失敗しました');
      const data: IssueTree = await res.json();
      setTree(data);
      setName(data.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : '不明なエラーが発生しました');
    } finally {
      setLoading(false);
    }
  }, [treeId, getHeaders]);

  useEffect(() => {
    if (treeId) fetchTree();
  }, [treeId, fetchTree]);

  // このツリーに紐づくGAP（課題）を取得（あれば上部に文脈表示）。
  // プロジェクトの gap-items から issueTreeId 一致を探す（専用APIが無いため）。
  const fetchLinkedGap = useCallback(async () => {
    if (!projectId || !treeId) return;
    try {
      const res = await fetch(`${API_URL}/api/projects/${projectId}/gap-items`, {
        headers: getHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json();
      const arr: Array<{
        issueTreeId: string | null;
        businessArea: string;
        gapDescription: string | null;
      }> = Array.isArray(data) ? data : [];
      const match = arr.find((g) => g.issueTreeId === treeId);
      setLinkedGap(
        match
          ? { businessArea: match.businessArea, gapDescription: match.gapDescription ?? null }
          : null,
      );
    } catch {
      // GAP 取得失敗はツリー編集を妨げない
    }
  }, [projectId, treeId, getHeaders]);

  useEffect(() => {
    fetchLinkedGap();
  }, [fetchLinkedGap]);

  // パターン（旧 type しか無い既存ツリーはフォールバック）。種別連動ボタン・ルート kind に使う。
  const pattern: IssueTreePattern = tree?.pattern ?? patternFromLegacyType(tree?.type);

  // 実ルート: parentId===null の実ノードが「ちょうど1つ」なら、それを木のトップとして扱う
  // （仮想ルートを描画しない）。0個 / 2個以上(レガシー)の時は null=従来の仮想ルートを使う。
  const realRootId = useMemo<string | null>(() => {
    const top = (tree?.nodes ?? []).filter((n) => n.parentId == null);
    return top.length === 1 ? top[0].id : null;
  }, [tree]);

  // ===========================================
  // ノードに紐づくタスク（調査 / 実行）
  // ===========================================

  // プロジェクト全タスクを 1 回取得し issueNodeId でグルーピング（カードのカウントバッジ用）。
  const fetchTasks = useCallback(async () => {
    if (!projectId) return;
    try {
      const data: TasksResponse = await tasksApi.list(projectId);
      const grouped: Record<string, Task[]> = {};
      for (const t of data.tasks) {
        if (!t.issueNodeId) continue;
        (grouped[t.issueNodeId] ??= []).push(t);
      }
      setTasksByNode(grouped);
    } catch {
      // タスク取得失敗はツリー編集を妨げない（バッジが出ないだけ）
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) fetchTasks();
  }, [projectId, fetchTasks]);

  // 指定ノードの紐づくタスクのみを再取得（GET tasks?issueNodeId=<nodeId>）。
  const refreshNodeTasks = useCallback(
    async (nodeId: string) => {
      if (!projectId) return;
      try {
        const token = localStorage.getItem('accessToken');
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(
          `${TASKS_API_URL}/api/projects/${projectId}/tasks?issueNodeId=${encodeURIComponent(nodeId)}`,
          { headers },
        );
        if (!res.ok) return;
        const data: TasksResponse = await res.json();
        setTasksByNode((prev) => ({ ...prev, [nodeId]: data.tasks }));
      } catch {
        // noop
      }
    },
    [projectId],
  );

  // 選択ノードに対する調査/実行タスクを作成（issueNodeId で紐付け、タイトルをラベルから補完）。
  const createTaskForNode = useCallback(
    async (node: BackendNode) => {
      if (!canEdit) return;
      const flavor = KIND_TASK_FLAVOR[node.kind];
      if (!flavor) return;
      setCreatingTaskNodeId(node.id);
      setActionError(null);
      try {
        const label = node.label?.trim() || '（無題）';
        await tasksApi.create(projectId, {
          title: `${flavor.titlePrefix}: ${label}`,
          issueNodeId: node.id,
        });
        await refreshNodeTasks(node.id);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'タスクの作成に失敗しました');
      } finally {
        setCreatingTaskNodeId(null);
      }
    },
    [projectId, refreshNodeTasks, canEdit],
  );

  // ===========================================
  // ミューテーション（安定ID・ノード単位 API）
  // ===========================================

  const addNode = useCallback(
    async (parentId: string | null, kind: IssueNodeKind, label: string) => {
      if (!canEdit) return;
      if (!tree) return;
      setBusy(true);
      setActionError(null);
      try {
        const res = await fetch(`${API_URL}/api/issue-trees/${treeId}/nodes`, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({ parentId, label, kind }),
        });
        if (!res.ok) throw new Error('ノードの作成に失敗しました');
        await fetchTree();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'ノードの作成に失敗しました');
      } finally {
        setBusy(false);
      }
    },
    [tree, treeId, getHeaders, fetchTree, canEdit],
  );

  // 種別連動の追加（カードの＋ボタン / ルート）。kind と既定ラベルは KIND_CONFIG 駆動。
  const addChild = useCallback(
    (parentId: string | null, kind: IssueNodeKind, label: string) => addNode(parentId, kind, label),
    [addNode],
  );
  // ルート直下に「最初の子」を追加（N ショートカット / ヘッダーボタン用）。
  // パターンに合う主役 kind を使う（ISSUE_POINT/WHY→論点/原因、How→打ち手候補 等）。
  // 実ルートがある時はその実ルートの子として足す（=二重ルートを作らない）。
  // 実ルートが無い（0個 / 2個以上）時は従来どおり parentId=null（仮想ルート直下）に足す。
  const addRootChild = useCallback(() => {
    const rootKind = rootKindForPattern(pattern);
    const buttons = addButtonsFor(rootKind, pattern);
    const first = buttons[0] ?? { childKind: 'POINT' as IssueNodeKind, defaultLabel: '新しい論点' };
    addNode(realRootId, first.childKind, first.defaultLabel);
  }, [addNode, pattern, realRootId]);

  // 発想法アシスト: チェック済み候補を子ノードとして一括追加（既存の add-node API を再利用）
  const addNodesBulk = useCallback(
    async (
      parentId: string | null,
      kind: IssueNodeKind,
      labels: string[],
    ): Promise<boolean> => {
      if (!tree || labels.length === 0) return false;
      setBusy(true);
      setActionError(null);
      try {
        const headers = getHeaders();
        for (const label of labels) {
          const res = await fetch(`${API_URL}/api/issue-trees/${treeId}/nodes`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ parentId, label, kind }),
          });
          if (!res.ok) throw new Error('ノードの作成に失敗しました');
        }
        await fetchTree();
        return true;
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'ノードの作成に失敗しました');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [tree, treeId, getHeaders, fetchTree],
  );

  // 種別が異なる候補をまとめて子ノードとして追加（AI候補の採用・例の挿入で使う）。
  const addNodesMixed = useCallback(
    async (
      parentId: string | null,
      items: { label: string; kind: IssueNodeKind }[],
    ): Promise<boolean> => {
      if (!canEdit) return false;
      if (!tree || items.length === 0) return false;
      setBusy(true);
      setActionError(null);
      try {
        const headers = getHeaders();
        for (const it of items) {
          const res = await fetch(`${API_URL}/api/issue-trees/${treeId}/nodes`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ parentId, label: it.label, kind: it.kind }),
          });
          if (!res.ok) throw new Error('ノードの作成に失敗しました');
        }
        await fetchTree();
        return true;
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'ノードの作成に失敗しました');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [tree, treeId, getHeaders, fetchTree, canEdit],
  );

  const openIdeate = useCallback((parentId: string | null) => {
    setIdeateParentId(parentId);
    setIdeateOpen(true);
  }, []);

  // 例を挿入（spec E）: このパターンの開始例(example.children)を対象ノードの子として一括追加。
  // 子の種別はパターン×対象ノード種別から決める（バックエンドの decideSuggestKind と整合）。
  const insertExample = useCallback(
    (parentId: string | null) => {
      const targetKind =
        parentId === null
          ? undefined
          : (tree?.nodes ?? []).find((n) => n.id === parentId)?.kind;
      const childKind = childKindForPattern(pattern, targetKind);
      const labels = PATTERN_META[pattern].example.children;
      void addNodesMixed(
        parentId,
        labels.map((label) => ({ label, kind: childKind })),
      );
    },
    [tree, pattern, addNodesMixed],
  );

  // ===========================================
  // 生成AI候補（spec D）
  // ===========================================

  // チェック済みのAI候補を子ノードとして採用（一括追加）。
  const adoptAiSuggestions = useCallback(
    (parentId: string | null, items: { label: string; kind: IssueNodeKind }[]) =>
      addNodesMixed(parentId, items),
    [addNodesMixed],
  );

  const openAiSuggest = useCallback((parentId: string | null) => {
    if (parentId === null) return; // 生成AIは対象ノードが必須
    setAiSuggestParentId(parentId);
    setAiSuggestOpen(true);
  }, []);

  // 生成AI候補を取得（POST .../nodes/:nodeId/ai-suggest）。
  // 4xx（鍵未設定など）は keyMissing で返し、ダイアログ側が設定導線に切り替える。
  const fetchAiSuggestions = useCallback(
    async (
      nodeId: string,
      context: string | undefined,
    ): Promise<{
      ok: boolean;
      suggestions: { label: string; kind: IssueNodeKind }[];
      keyMissing: boolean;
      message?: string;
    }> => {
      try {
        const res = await fetch(
          `${API_URL}/api/issue-trees/${treeId}/nodes/${nodeId}/ai-suggest`,
          {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(context ? { context } : {}),
          },
        );
        if (!res.ok) {
          const keyMissing = res.status === 400;
          let message: string | undefined;
          try {
            const data = await res.json();
            message = data?.error ?? data?.message;
          } catch {
            // noop
          }
          return { ok: false, suggestions: [], keyMissing, message };
        }
        const data = await res.json();
        const suggestions = Array.isArray(data?.suggestions)
          ? data.suggestions.map((s: { label: string; kind: IssueNodeKind }) => ({
              label: s.label,
              kind: s.kind,
            }))
          : [];
        return { ok: true, suggestions, keyMissing: false };
      } catch {
        return {
          ok: false,
          suggestions: [],
          keyMissing: false,
          message: '通信エラーが発生しました',
        };
      }
    },
    [treeId, getHeaders],
  );

  // 発想法レンズ文脈つきの AI 子ノード候補取得（POST .../ai-suggest）。
  // ideationMethodName / ideationLenses をボディに追加して投げ、形は fetchAiSuggestions と同じ。
  const fetchAiSuggestionsForIdeation = useCallback(
    async (args: {
      nodeId: string;
      ideationMethodName: string;
      ideationLenses: string[];
      context?: string;
    }): Promise<{
      ok: boolean;
      suggestions: { label: string; kind: IssueNodeKind }[];
      keyMissing: boolean;
      message?: string;
    }> => {
      try {
        const res = await fetch(
          `${API_URL}/api/issue-trees/${treeId}/nodes/${args.nodeId}/ai-suggest`,
          {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({
              ...(args.context ? { context: args.context } : {}),
              ideationMethodName: args.ideationMethodName,
              ideationLenses: args.ideationLenses,
            }),
          },
        );
        if (!res.ok) {
          const keyMissing = res.status === 400;
          let message: string | undefined;
          try {
            const data = await res.json();
            message = data?.error ?? data?.message;
          } catch {
            // noop
          }
          return { ok: false, suggestions: [], keyMissing, message };
        }
        const data = await res.json();
        const suggestions = Array.isArray(data?.suggestions)
          ? data.suggestions.map((s: { label: string; kind: IssueNodeKind }) => ({
              label: s.label,
              kind: s.kind,
            }))
          : [];
        return { ok: true, suggestions, keyMissing: false };
      } catch {
        return {
          ok: false,
          suggestions: [],
          keyMissing: false,
          message: '通信エラーが発生しました',
        };
      }
    },
    [treeId, getHeaders],
  );

  const patchNode = useCallback(
    async (nodeId: string, body: Record<string, unknown>) => {
      if (!canEdit) return;
      setBusy(true);
      setActionError(null);
      try {
        const res = await fetch(`${API_URL}/api/issue-trees/${treeId}/nodes/${nodeId}`, {
          method: 'PUT',
          headers: getHeaders(),
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('ノードの更新に失敗しました');
        await fetchTree();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'ノードの更新に失敗しました');
      } finally {
        setBusy(false);
      }
    },
    [treeId, getHeaders, fetchTree, canEdit],
  );

  const setVerification = useCallback(
    async (nodeId: string, verification: Verification) => {
      if (!canEdit) return;
      setBusy(true);
      setActionError(null);
      try {
        const res = await fetch(
          `${API_URL}/api/issue-trees/${treeId}/nodes/${nodeId}/verification`,
          {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify({ verification }),
          },
        );
        if (!res.ok) throw new Error('検証状態の更新に失敗しました');
        await fetchTree();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : '検証状態の更新に失敗しました');
      } finally {
        setBusy(false);
      }
    },
    [treeId, getHeaders, fetchTree, canEdit],
  );

  const deleteNode = useCallback(
    async (nodeId: string) => {
      if (!canEdit) return;
      if (!window.confirm('このノードと配下の子ノードを削除します。よろしいですか？')) return;
      setBusy(true);
      setActionError(null);
      try {
        const res = await fetch(`${API_URL}/api/issue-trees/${treeId}/nodes/${nodeId}`, {
          method: 'DELETE',
          headers: getHeaders(),
        });
        if (!res.ok && res.status !== 404) throw new Error('ノードの削除に失敗しました');
        setSelectedId((cur) => (cur === nodeId ? null : cur));
        await fetchTree();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'ノードの削除に失敗しました');
      } finally {
        setBusy(false);
      }
    },
    [treeId, getHeaders, fetchTree, canEdit],
  );

  // 範囲選択(矩形/Shift+クリック)した複数ノードをまとめて削除する。
  // deleteNode と同じ DELETE /nodes/:id を id ごとに順次叩く。親を消すと子も
  // カスケード削除されるため、選択に含まれる子が後で 404 を返しても成功扱いにする。
  const deleteMultipleNodes = useCallback(
    async (ids: string[]) => {
      if (!canEdit) return;
      if (ids.length === 0) return;
      const message =
        ids.length === 1
          ? 'このノードと配下の子ノードを削除します。よろしいですか？'
          : `${ids.length}個のノードと配下の子ノードを削除します。よろしいですか？`;
      if (!window.confirm(message)) return;
      setBusy(true);
      setActionError(null);
      try {
        const headers = getHeaders();
        for (const id of ids) {
          const res = await fetch(`${API_URL}/api/issue-trees/${treeId}/nodes/${id}`, {
            method: 'DELETE',
            headers,
          });
          // 親のカスケード削除で既に消えた子は 404 になり得る → 成功扱い。
          if (!res.ok && res.status !== 404) throw new Error('ノードの削除に失敗しました');
        }
        setSelectedId(null);
        await fetchTree();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'ノードの削除に失敗しました');
      } finally {
        setBusy(false);
      }
    },
    [treeId, getHeaders, fetchTree, canEdit],
  );

  // 親リンクを外す（＝子ノードをルート直下へ移す / デタッチ）。
  // 既存の PUT /nodes/:nodeId { parentId: null } を再利用する非破壊操作。
  // ノードや配下のサブツリーは消さない（“削除”ではなく“切り離し”）。
  const detachNode = useCallback(
    async (nodeId: string) => {
      if (!canEdit) return;
      setBusy(true);
      setActionError(null);
      try {
        const res = await fetch(`${API_URL}/api/issue-trees/${treeId}/nodes/${nodeId}`, {
          method: 'PUT',
          headers: getHeaders(),
          body: JSON.stringify({ parentId: null }),
        });
        if (!res.ok) throw new Error('親リンクの解除に失敗しました');
        setSelectedEdgeId(null);
        await fetchTree();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : '親リンクの解除に失敗しました');
      } finally {
        setBusy(false);
      }
    },
    [treeId, getHeaders, fetchTree, canEdit],
  );

  const saveName = useCallback(async () => {
    if (!canEdit) return;
    if (!tree) return;
    setEditingName(false);
    const next = name.trim();
    if (!next || next === tree.name) {
      setName(tree.name);
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`${API_URL}/api/issue-trees/${treeId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ name: next }),
      });
      if (!res.ok) throw new Error('ツリー名の更新に失敗しました');
      await fetchTree();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'ツリー名の更新に失敗しました');
    } finally {
      setBusy(false);
    }
  }, [tree, name, treeId, getHeaders, fetchTree, canEdit]);

  // ===========================================
  // markdown 取り込み（作成時のみ・親→子順に POST）
  // ===========================================

  const verifyToKind = (v: Verification, r: Recommendation): IssueNodeKind => {
    if (r !== 'NA') return 'COUNTERMEASURE';
    return 'CAUSE';
  };

  const handleImport = useCallback(async () => {
    if (!tree) return;
    setImporting(true);
    setImportError(null);
    try {
      const headers = getHeaders();
      const parsed = parseIssueMarkdown(importText);
      const flat = flattenIssueTree(parsed.nodes);
      const createdIds: string[] = [];

      for (let i = 0; i < flat.length; i++) {
        const { node, order, parentIndex } = flat[i];
        const parentId = parentIndex !== null ? createdIds[parentIndex] : null;
        const legacyType = legacyTreeTypeForPattern(pattern);
        const kind =
          legacyType === 'SOLUTION'
            ? verifyToKind(node.verification, node.recommendation)
            : node.recommendation !== 'NA'
              ? 'COUNTERMEASURE'
              : parentId === null
                ? 'ISSUE'
                : 'CAUSE';

        const body = {
          label: node.label || '（無題）',
          parentId,
          order,
          kind,
          verification: node.verification,
          recommendation: node.recommendation,
          evidence: node.evidence ?? null,
          metadata: { links: node.links },
        };

        const res = await fetch(`${API_URL}/api/issue-trees/${treeId}/nodes`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('ノードの作成に失敗しました');
        const created: BackendNode = await res.json();
        createdIds[i] = created.id;
      }

      // ルートの問いも反映（あれば）
      if (parsed.title && parsed.title !== (tree.rootQuestion ?? '')) {
        await fetch(`${API_URL}/api/issue-trees/${treeId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ rootQuestion: parsed.title }),
        });
      }

      setImportOpen(false);
      setImportText('');
      await fetchTree();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : '取り込みに失敗しました');
    } finally {
      setImporting(false);
    }
  }, [tree, treeId, importText, getHeaders, fetchTree, pattern]);

  // ===========================================
  // React Flow ノード / エッジ生成
  // ===========================================

  const { rfNodes, rfEdges } = useMemo<{ rfNodes: Node[]; rfEdges: Edge[] }>(() => {
    if (!tree) return { rfNodes: [], rfEdges: [] };

    const backendNodes = tree.nodes ?? [];
    const rootQuestion = tree.rootQuestion ?? '';

    // 実ルートの判定（コンポーネント上位の realRootId memo を共有）。
    // parentId===null の実ノードが「ちょうど1つ」なら、それを木のトップに据え、
    // 仮想ルート(ROOT_ID)ノード/エッジは描画しない（「ルートの問い」と実「課題」の二重表示を解消）。
    // 0個 / 2個以上（レガシー・複数ルート）の時のみ従来の仮想ルートにぶら下げる。
    const useVirtualRoot = realRootId === null;
    const layoutRootId = realRootId ?? ROOT_ID;

    // 親→子の隣接マップ（order でソート）。
    // 実ルート時は実ルートを根に構築（ROOT_ID キーは作らない）。
    // 仮想ルート時はルート直下のノードを ROOT_ID にぶら下げる。
    const childrenMap = new Map<string, string[]>();
    if (useVirtualRoot) childrenMap.set(ROOT_ID, []);
    const sorted = [...backendNodes].sort((a, b) =>
      a.depth !== b.depth ? a.depth - b.depth : a.order - b.order,
    );
    for (const n of sorted) {
      const parentKey = n.parentId ?? (useVirtualRoot ? ROOT_ID : n.id);
      if (!childrenMap.has(parentKey)) childrenMap.set(parentKey, []);
      // 実ルート（parentId=null & 実ルート採用）は自分自身が根なので子リストに足さない。
      if (!(realRootId && n.parentId == null)) childrenMap.get(parentKey)!.push(n.id);
      if (!childrenMap.has(n.id)) childrenMap.set(n.id, []);
    }

    const layout = computeLayout(layoutRootId, childrenMap, spacing);

    // 発散→収束（spec C）: 配下の RESULT/検証結果(○×△) を各ノードへロールアップ集約。
    // RESULT ノード自身の verification を種に、子の集約を足し上げてバッジを作る。
    const nodeById = new Map(backendNodes.map((n) => [n.id, n]));
    const rollupByNode = computeRollups(backendNodes, childrenMap, nodeById);

    // 打ち手の「採用」連動グレーアウト: 同じ親配下の打ち手系兄弟に ADOPT があれば、
    // ADOPT でない兄弟を淡色にする（淡色対象ノードID集合）。
    const dimmedIds = computeDimmedNodeIds(backendNodes);

    const baseData = {
      pattern,
      rootQuestion,
      onSelect: setSelectedId,
      onAddChild: addChild,
      onIdeate: openIdeate,
      onAiSuggest: openAiSuggest,
      onInsertExample: insertExample,
      onDelete: deleteNode,
    };

    const nodes: Node[] = [];
    // 仮想ルートを使う時だけ「ルートの問い」ノードを描画する。
    // 実ルート（parentId=null の実ノードが1つ）の時は実ノード自身がトップなので描画しない。
    if (useVirtualRoot) {
      nodes.push({
        id: ROOT_ID,
        type: 'mind',
        position: layout.get(ROOT_ID) ?? { x: 0, y: 0 },
        data: {
          ...baseData,
          node: null,
          isRoot: true,
          selected: selectedId === null && false, // ルートは明示選択しないと反転させない
          taskCount: 0,
          dimmed: false, // ルート（仮想）は採用連動の対象外
          rollup: rollupByNode.get(ROOT_ID) ?? null,
        } as unknown as Record<string, unknown>,
        draggable: false,
      });
    }

    for (const n of backendNodes) {
      // 位置 = 保存済み(metadata.x/y が数値)優先、無ければ computeLayout の座標。
      // ドラッグ確定で metadata.x/y を保存するので、再フェッチ後もここで一致し戻らない。
      const computed = layout.get(n.id) ?? { x: n.depth * X_GAP * spacing, y: 0 };
      const savedX = n.metadata?.x;
      const savedY = n.metadata?.y;
      const position =
        typeof savedX === 'number' && typeof savedY === 'number'
          ? { x: savedX, y: savedY }
          : computed;
      nodes.push({
        id: n.id,
        type: 'mind',
        position,
        data: {
          ...baseData,
          node: n,
          isRoot: false,
          selected: selectedId === n.id,
          taskCount: tasksByNode[n.id]?.length ?? 0,
          dimmed: dimmedIds.has(n.id),
          rollup: rollupByNode.get(n.id) ?? null,
        } as unknown as Record<string, unknown>,
        // 実ノードはマウスでドラッグ移動可（仮想ルートは draggable:false のまま）。
        draggable: true,
      });
    }

    const edges: Edge[] = backendNodes
      // 実ルートはトップ（親なし・仮想ルートも描画しない）なので親エッジを引かない。
      .filter((n) => !(realRootId !== null && n.id === realRootId))
      .map((n) => {
      const edgeId = `e-${n.parentId ?? ROOT_ID}-${n.id}`;
      // ルート直下のノードは「仮想ルート」にぶら下がるだけで実際の親リンクは無い。
      // よってデタッチ（親外し）はできない（既に親なし）。実ノード→実ノードのみ外せる。
      const detachable = n.parentId != null;
      return {
        id: edgeId,
        source: n.parentId ?? ROOT_ID,
        target: n.id,
        type: 'issue',
        selected: edgeId === selectedEdgeId,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8', width: 16, height: 16 },
        data: {
          shape: edgeShape,
          detachable,
          childNodeId: n.id,
          onDetach: detachable ? detachNode : undefined,
        } as unknown as Record<string, unknown>,
      };
    });

    return { rfNodes: nodes, rfEdges: edges };
  }, [
    tree,
    pattern,
    realRootId,
    selectedId,
    selectedEdgeId,
    edgeShape,
    spacing,
    tasksByNode,
    addChild,
    openIdeate,
    openAiSuggest,
    insertExample,
    deleteNode,
    detachNode,
  ]);

  // 自由配置: 制御モードの React Flow はドラッグで位置を動かすのに onNodesChange が要る。
  // 決定的レイアウト(rfNodes)を初期値にした内部 state を持ち、ドラッグ中の位置変更を反映する。
  // rfNodes が再計算されたら(再フェッチ・選択変更など)正規位置へ同期し直す。
  const [dragNodes, setDragNodes, onNodesChange] = useNodesState(rfNodes);
  useEffect(() => {
    setDragNodes(rfNodes);
  }, [rfNodes, setDragNodes]);

  // ドラッグ確定で位置を保存。複数選択を一気に動かした場合は **動かした全ノード** を保存する
  // （単一ノードだけ保存されるバグ修正）。実ノードのみ metadata に { ...既存, x, y } を merge。
  const persistNodePositions = useCallback(
    (nodes: Node[]) => {
      const real = tree?.nodes ?? [];
      for (const node of nodes) {
        if (node.id === ROOT_ID) continue;
        const src = real.find((n) => n.id === node.id);
        if (!src) continue;
        patchNode(node.id, {
          metadata: { ...(src.metadata ?? {}), x: node.position.x, y: node.position.y },
        });
      }
    },
    [tree, patchNode],
  );
  // React Flow v12: 第3引数 nodes = 同時にドラッグした全ノード（複数選択時は全部入る）。
  const handleNodeDragStop = useCallback(
    (_evt: unknown, node: Node, nodes?: Node[]) => {
      persistNodePositions(nodes && nodes.length > 0 ? nodes : [node]);
    },
    [persistNodePositions],
  );
  // 矩形選択をまとめてドラッグした場合（選択ドラッグ）も全ノードを保存。
  const handleSelectionDragStop = useCallback(
    (_evt: unknown, nodes: Node[]) => {
      persistNodePositions(nodes ?? []);
    },
    [persistNodePositions],
  );

  // 全実ノードの metadata から x/y を消して保存し、computeLayout レイアウトに戻す（整形の本体）。
  // 次の rfNodes 再計算で metadata.x/y が無いノードは computeLayout 座標を使う(初期値ロジック)。
  // 手動配置が無い場合でも computeLayout は spacing を見て再計算されるので、
  // 「広げる/狭める」(spacing 変更)単体でも再レイアウトされる。
  const resetSavedPositions = useCallback(async () => {
    if (!canEdit) return;
    const nodes = tree?.nodes ?? [];
    const targets = nodes.filter(
      (n) => typeof n.metadata?.x === 'number' || typeof n.metadata?.y === 'number',
    );
    if (targets.length === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      const headers = getHeaders();
      for (const n of targets) {
        const rest = { ...(n.metadata ?? {}) };
        delete rest.x;
        delete rest.y;
        const res = await fetch(`${API_URL}/api/issue-trees/${treeId}/nodes/${n.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ metadata: rest }),
        });
        if (!res.ok) throw new Error('整形（位置リセット）に失敗しました');
      }
      await fetchTree();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '整形に失敗しました');
    } finally {
      setBusy(false);
    }
  }, [tree, treeId, getHeaders, fetchTree, canEdit]);

  // 「整形」: 手動配置を破棄して spacing は据え置きのまま自動レイアウトへ戻す。
  const tidyLayout = useCallback(() => {
    void resetSavedPositions();
  }, [resetSavedPositions]);

  // 「広げる / 狭める」: 間隔係数 spacing を増減し、手動配置を消して自動レイアウトを再適用。
  // spacing は SPACING_MIN〜SPACING_MAX にクランプ（重ならない範囲）。
  // computeLayout(spacing) は rfNodes useMemo で再計算され、保存位置が無いノードに反映される。
  const changeSpacing = useCallback(
    (delta: number) => {
      // 更新関数は純粋に保ち、副作用(保存位置クリア)は外で実行（StrictMode 二重起動対策）。
      const next = clampSpacing(spacing + delta);
      if (next === spacing) return;
      setSpacing(next);
      // 手動でドラッグ配置したノードは spacing を無視してしまうので、整形と同様に位置を消す。
      void resetSavedPositions();
    },
    [spacing, resetSavedPositions],
  );
  const widenLayout = useCallback(() => changeSpacing(SPACING_STEP), [changeSpacing]);
  const narrowLayout = useCallback(() => changeSpacing(-SPACING_STEP), [changeSpacing]);

  const selectedNode = useMemo(
    () => (selectedId ? (tree?.nodes ?? []).find((n) => n.id === selectedId) ?? null : null),
    [selectedId, tree],
  );

  // Delete / Backspace の対象を決める。
  // エッジ選択中は「親リンクを外す」（非破壊・デタッチ）、ノード選択中はノード削除。
  // エッジIDは UUID にハイフンを含むため文字列分割せず、rfEdges.data.childNodeId を引く。
  const deleteSelected = useCallback(() => {
    if (busy) return;
    if (selectedEdgeId) {
      const edge = rfEdges.find((e) => e.id === selectedEdgeId);
      const ed = edge?.data as unknown as IssueEdgeData | undefined;
      if (ed?.detachable && ed.childNodeId) detachNode(ed.childNodeId);
      return;
    }
    // 矩形/Shift+クリックで選択中の(仮想ルートを除く)全ノードを優先して削除。
    const selectedIds = dragNodes
      .filter((n) => n.selected && n.id !== ROOT_ID)
      .map((n) => n.id);
    if (selectedIds.length > 0) {
      void deleteMultipleNodes(selectedIds);
      return;
    }
    if (selectedId) deleteNode(selectedId);
  }, [busy, selectedEdgeId, rfEdges, dragNodes, selectedId, detachNode, deleteNode, deleteMultipleNodes]);

  // キーボードショートカット
  // Shift+/（?） … 操作方法 / N … 論点を追加 / Delete・Backspace … 選択ノードを削除 /
  // ⌘/Ctrl+S … ブラウザ保存を抑止（編集は自動保存される）
  useKeyboardShortcuts([
    {
      combo: 'shift+/',
      handler: () => howToRef.current?.querySelector('button')?.click(),
    },
    {
      combo: 'n',
      handler: () => {
        if (!busy) addRootChild();
      },
    },
    {
      combo: 'delete',
      handler: () => deleteSelected(),
    },
    {
      combo: 'backspace',
      handler: () => deleteSelected(),
    },
    {
      combo: 'mod+s',
      whenTyping: true,
      handler: () => {
        /* 自動保存のため何もしない（ブラウザ保存ダイアログのみ抑止） */
      },
    },
  ]);

  // ===========================================
  // 描画
  // ===========================================

  if (loading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !tree) {
    return (
      <div className="space-y-4">
        <Link href={`/dashboard/projects/${projectId}/issue-trees`}>
          <Button variant="ghost" className="text-gray-600">
            <ChevronLeft className="mr-1 h-4 w-4" />
            イシューツリー一覧に戻る
          </Button>
        </Link>
        <Card className="border-red-200 bg-white">
          <CardContent className="py-8 text-center">
            <p className="text-red-600">{error || 'イシューツリーが見つかりません'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const patternMeta = PATTERN_META[pattern];

  return (
    <div className="flex h-[calc(100vh-120px)] min-h-[520px] flex-col gap-3">
      {/* ヘッダー */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={`/dashboard/projects/${projectId}/issue-trees`}>
            <Button variant="ghost" size="sm" className="text-gray-600">
              <ChevronLeft className="mr-1 h-4 w-4" />
              一覧
            </Button>
          </Link>
          <div className="min-w-0">
            {editingName ? (
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveName();
                }}
                autoFocus
                className="h-9 w-72 border-gray-300 bg-white text-lg font-bold"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingName(true)}
                className="group flex items-center gap-2 text-left"
                title="クリックして編集"
              >
                <h1 className="truncate text-2xl font-bold text-gray-900">{name || '（無題）'}</h1>
                <Pencil className="h-4 w-4 text-gray-300 group-hover:text-gray-500" />
              </button>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className={`rounded border px-2 py-0.5 text-xs font-medium ${patternMeta.badge}`}>
                {patternMeta.label}
              </span>
              <span className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-500">
                {patternMeta.sublabel}
              </span>
              <HelpTooltip
                text={`${patternMeta.description} パターンは開始テンプレで、ノード種別は混在可・配置は強制されません（後から変更可）。`}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {busy && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          <div ref={howToRef}>
            <HowToPanel
              title={`課題ツリーの使い方（${patternMeta.label}）`}
              steps={[
                `このツリーは「${patternMeta.label}」パターンです。${patternMeta.guide}`,
                `開始例：「${patternMeta.example.rootLabel}」→ ${patternMeta.example.children.join(' / ')}（ノードの「例を挿入」で取り込めます）。`,
                'ノード上の「＋原因」でその下に原因を、「＋打ち手」で打ち手を追加します。ルートの問いからも追加できます。先頭3件以外の種別は「他」メニューから追加できます。',
                'ノードを選んで「AIで候補生成」を押すと、文脈に沿った子ノード候補を生成AIが提案します。チェックして採用すると子ノードになります（AI鍵の設定が必要）。',
                'ノードをクリックすると右パネルが開き、種別・ラベル・根拠を編集できます。',
                'ノードの「発想法で分解」から IPLoT 発想法（SDF/RTOCS/横展開ほか）のレンズを選び、子ノード候補を一括で生成できます。',
                '原因ノードは検証マーク（○確定／×否定／△未確認／?要ヒアリング）で確からしさを記録します。',
                '打ち手ノードは推奨（採用／保留／不採用）を設定して取捨選択します。',
                '原因（なぜ）ノードからは「調査タスク」、打ち手ノードからは「実行タスク」を作成し、ノードに紐づけてタスク管理できます。紐づくタスクは右パネルに一覧表示されます。',
                '親→子をつなぐ線（矢印）はどこをクリックしても選択できます。選択中の線の中点に出る「鎖を外す」ボタン（または Delete）で、その子ノードを親から切り離してルート直下へ移動できます（ノード自体は削除されません）。',
                '右上の「角ばり / 曲線」で線の見た目を切り替えられます（ツリーごとに保存されます）。',
                'ヘッダーの「整形」で手動配置をリセットして自動レイアウトに戻せます。「狭める / 広げる」でノード間の距離（間隔）を一括で詰めたり空けたりできます（手動配置はリセットされます）。',
                '何もない所を左ドラッグすると矩形で複数ノードをまとめて選択できます。画面の移動（パン）は中ボタン / 右ボタンのドラッグで行います。',
                '「テキストから取り込み」でインデント箇条書きを一括投入できます（作成時向け）。',
              ]}
              shortcuts={[
                { keys: 'N', desc: 'ルート直下に論点を追加' },
                { keys: 'Delete / Backspace', desc: '選択中のノードを削除 / 線を選択中なら親リンクを外す' },
                { keys: '⌘/Ctrl+S', desc: '保存は自動（ブラウザ保存を抑止）' },
                { keys: 'Shift+/（?）', desc: 'この操作方法を開く' },
              ]}
            />
          </div>
          <ManualButton feature="issue-trees" />
          <ExportImportButton
            label="イシューツリー"
            fileBaseName={`issue-tree-${name || treeId}`}
            size="sm"
            canEdit={canEdit}
            withModeChoice={false}
            importHint="選択した JSON でこのイシューツリーのノードを丸ごと置き換えます。既存ノードは全削除され、localId 参照で作り直されます（depth は親子関係から自動再計算）。注意: 他ツリーの確定ノードを指す根本原因リンク（rootCauseLocalId に他ツリーの DB id を入れたもの）は原値のまま保持されますが、このツリー内 localId は新しい id に振り直されます。get→PUT のラウンドトリップ以外でノードを差し替えると、このツリーを参照していた外部リンクが切れることがあります。"
            getExport={() => entityJsonIo.exportIssueTree(treeId)}
            onImport={(parsed) =>
              entityJsonIo.importIssueTree(treeId, parsed as EntityBundle)
            }
            onDone={() => void fetchTree()}
          />
          <Button variant="outline" size="sm" onClick={fetchTree} className="text-gray-600">
            <RefreshCw className="mr-1 h-4 w-4" />
            再読込
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={tidyLayout}
            disabled={busy}
            className="text-gray-600"
            title="ノードの手動配置をリセットして自動レイアウトに戻す"
          >
            <LayoutGrid className="mr-1 h-4 w-4" />
            整形
          </Button>
          {/* 距離を空ける / 狭める: 間隔係数 spacing を増減して自動レイアウトを再適用 */}
          <div className="flex items-center rounded-md border border-gray-200">
            <button
              type="button"
              onClick={narrowLayout}
              disabled={busy || spacing <= SPACING_MIN}
              title="ノード間の距離を狭める"
              className="flex items-center gap-1 rounded-l-md px-2 py-1.5 text-xs text-gray-600 transition hover:bg-gray-50 disabled:opacity-40"
            >
              <Minimize2 className="h-3.5 w-3.5" />
              狭める
            </button>
            <span className="border-x border-gray-200 px-2 py-1.5 text-[11px] tabular-nums text-gray-500">
              {Math.round(spacing * 100)}%
            </span>
            <button
              type="button"
              onClick={widenLayout}
              disabled={busy || spacing >= SPACING_MAX}
              title="ノード間の距離を広げる"
              className="flex items-center gap-1 rounded-r-md px-2 py-1.5 text-xs text-gray-600 transition hover:bg-gray-50 disabled:opacity-40"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              広げる
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleFullscreen}
            className="text-gray-600"
            title={isFullscreen ? '全画面を解除（Esc）' : 'キャンバスを全画面表示'}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="mr-1 h-4 w-4" />
                全画面解除
              </>
            ) : (
              <>
                <Maximize2 className="mr-1 h-4 w-4" />
                全画面
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setImportError(null);
              setImportOpen(true);
            }}
            className="text-gray-600"
          >
            <FileText className="mr-1 h-4 w-4" />
            テキストから取り込み
          </Button>
          <Button size="sm" onClick={addRootChild} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="mr-1 h-4 w-4" />
            {addButtonsFor(rootKindForPattern(pattern), pattern)[0]?.label ?? '追加'}
          </Button>
        </div>
      </div>

      {actionError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {actionError}
        </div>
      )}

      {/* GAP（課題）紐づけ: このツリーが GAP 起点なら文脈を上部に表示（spec E） */}
      {linkedGap && (
        <div className="flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50/60 p-2.5 text-sm">
          <Target className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-indigo-700">起点のGAP（課題）</span>
              <span className="rounded border border-indigo-200 bg-white px-1.5 py-0.5 text-[10px] text-indigo-600">
                {linkedGap.businessArea}
              </span>
            </div>
            {linkedGap.gapDescription && (
              <p className="mt-0.5 text-[13px] text-gray-700">{linkedGap.gapDescription}</p>
            )}
          </div>
        </div>
      )}

      {/* キャンバス + サイドパネル */}
      <div className="relative flex flex-1 gap-3 overflow-hidden">
        <Card
          className={
            isFullscreen
              ? 'fixed inset-0 z-50 m-0 overflow-hidden rounded-none border-0 bg-white'
              : 'flex-1 overflow-hidden border-gray-200 bg-white'
          }
        >
          <CardContent className="h-full p-0">
            <ReactFlow
              nodes={dragNodes}
              edges={rfEdges}
              onNodesChange={onNodesChange}
              onNodeDragStop={handleNodeDragStop}
              onSelectionDragStop={handleSelectionDragStop}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onPaneClick={() => {
                setSelectedId(null);
                setSelectedEdgeId(null);
              }}
              onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.2}
              maxZoom={1.5}
              proOptions={{ hideAttribution: true }}
              nodesDraggable={canEdit}
              nodesConnectable={false}
              elementsSelectable
              // 矩形範囲選択: 空白(ペーン)を左ドラッグすると矩形で複数ノードを選択。
              // パンは中ボタン/右ボタンドラッグに割り当て、左ドラッグの矩形選択と両立させる。
              // ノードの左ドラッグ移動(nodesDraggable)・クリック選択はノード上の操作なので衝突しない。
              // partial=矩形に一部でも重なれば選択。
              selectionOnDrag
              selectionMode={SelectionMode.Partial}
              panOnDrag={[1, 2]}
              // 2本指スクロール = パン（移動）。ズームはピンチ（zoomOnPinch 既定 true）と
              // コントロール（+/-）に限定し、スクロールでのズームは無効化する。
              panOnScroll
              zoomOnScroll={false}
              // 標準の Delete はノードまで巻き込むため無効化し、矢印の切り離しは自前で扱う。
              deleteKeyCode={null}
            >
              <Background color="#e2e8f0" gap={20} />
              <Controls showInteractive={false} />
              <Panel position="top-right" className="rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => changeEdgeShape('smoothstep')}
                    title="線を角ばりにする（保存されます）"
                    className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition ${
                      edgeShape === 'smoothstep'
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    <Waypoints className="h-3.5 w-3.5" />
                    角ばり
                  </button>
                  <button
                    type="button"
                    onClick={() => changeEdgeShape('bezier')}
                    title="線を曲線にする（保存されます）"
                    className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition ${
                      edgeShape === 'bezier'
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    <Spline className="h-3.5 w-3.5" />
                    曲線
                  </button>
                </div>
              </Panel>
            </ReactFlow>
          </CardContent>
        </Card>

        {/* 右: 選択ノードの編集パネル */}
        {selectedNode && (
          <NodeEditPanel
            key={selectedNode.id}
            node={selectedNode}
            busy={busy}
            linkedTasks={tasksByNode[selectedNode.id] ?? []}
            creatingTask={creatingTaskNodeId === selectedNode.id}
            onLoadTasks={refreshNodeTasks}
            onCreateTask={createTaskForNode}
            onClose={() => setSelectedId(null)}
            onPatch={patchNode}
            onSetVerification={setVerification}
            onIdeate={openIdeate}
            onAiSuggest={openAiSuggest}
            onInsertExample={insertExample}
            patternLabel={patternMeta.label}
            exampleCount={patternMeta.example.children.length}
            pattern={pattern}
            parentKind={
              selectedNode.parentId
                ? (tree?.nodes ?? []).find((n) => n.id === selectedNode.parentId)?.kind ?? null
                : null
            }
            onDelete={deleteNode}
          />
        )}
      </div>

      {/* 取り込みダイアログ */}
      <Dialog open={importOpen} onOpenChange={(o) => !importing && setImportOpen(o)}>
        <DialogContent className="bg-white sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>テキストから取り込み</DialogTitle>
            <DialogDescription>
              インデント箇条書き（2スペース＝1階層 / 行頭マーク ○×△? / [採用]等）をノードとして作成します。
              これは作成時の一括投入用です。以降の編集は GUI で行ってください。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            spellCheck={false}
            placeholder={`# なぜ解約率が高いのか？\n- [△] オンボーディングが分かりにくい\n  - [○] 初回設定が複雑\n  - [?] サポート導線が不明\n- [採用] チュートリアル改善`}
            className="h-64 resize-none font-mono text-sm"
          />
          {importError && (
            <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {importError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importing}>
              キャンセル
            </Button>
            <Button
              onClick={handleImport}
              disabled={importing || !importText.trim()}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  取り込み中...
                </>
              ) : (
                '取り込む'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 発想法アシスト（分解）ダイアログ */}
      <IdeationAssistDialog
        open={ideateOpen}
        onOpenChange={setIdeateOpen}
        parentId={ideateParentId}
        parentLabel={
          ideateParentId === null
            ? tree.rootQuestion ?? ''
            : (tree.nodes ?? []).find((n) => n.id === ideateParentId)?.label ?? ''
        }
        treeType={legacyTreeTypeForPattern(pattern)}
        onAdd={addNodesBulk}
        treeId={treeId}
        onAiSuggest={fetchAiSuggestionsForIdeation}
        onAdoptAi={adoptAiSuggestions}
        settingsHref="/dashboard/settings"
      />

      {/* 生成AI候補ダイアログ（spec D） */}
      <AiSuggestDialog
        open={aiSuggestOpen}
        onOpenChange={setAiSuggestOpen}
        parentId={aiSuggestParentId}
        parentLabel={
          aiSuggestParentId === null
            ? tree.rootQuestion ?? ''
            : (tree.nodes ?? []).find((n) => n.id === aiSuggestParentId)?.label ?? ''
        }
        settingsHref="/dashboard/settings"
        onFetch={fetchAiSuggestions}
        onAdopt={adoptAiSuggestions}
      />
    </div>
  );
}

// ===========================================
// 編集パネル（選択ノード）
// ===========================================

function NodeEditPanel({
  node,
  busy,
  linkedTasks,
  creatingTask,
  onLoadTasks,
  onCreateTask,
  onClose,
  onPatch,
  onSetVerification,
  onIdeate,
  onAiSuggest,
  onInsertExample,
  patternLabel,
  exampleCount,
  pattern,
  parentKind,
  onDelete,
}: {
  node: BackendNode;
  busy: boolean;
  linkedTasks: Task[];
  creatingTask: boolean;
  onLoadTasks: (nodeId: string) => void;
  onCreateTask: (node: BackendNode) => void;
  onClose: () => void;
  onPatch: (nodeId: string, body: Record<string, unknown>) => void;
  onSetVerification: (nodeId: string, verification: Verification) => void;
  onIdeate: (nodeId: string | null) => void;
  onAiSuggest: (nodeId: string | null) => void;
  onInsertExample: (nodeId: string | null) => void;
  patternLabel: string;
  exampleCount: number;
  /** ツリーのパターン（ルートで選べる種別の算出に使う） */
  pattern: IssueTreePattern;
  /** 親ノードの種別。親が無いルートは null（rootAllowedKinds を使う） */
  parentKind: IssueNodeKind | null;
  onDelete: (nodeId: string) => void;
}) {
  const [label, setLabel] = useState(node.label);
  const [evidence, setEvidence] = useState(node.evidence ?? '');
  const kind: IssueNodeKind = node.kind ?? 'ISSUE';
  const cfg = KIND_CONFIG[kind];
  const flavor = KIND_TASK_FLAVOR[kind];

  // 種別セレクタの選択肢: 親種別で許可された子種別（親が無いルートは rootAllowedKinds）に
  // 現在の自種別を常に加えて絞り込む。取り違え救済として「全種別を表示」トグルで全11種別へ。
  const [showAllKinds, setShowAllKinds] = useState(false);
  const kindOptions = useMemo<IssueNodeKind[]>(() => {
    if (showAllKinds) return KIND_OPTIONS;
    const allowed = parentKind ? allowedChildKinds(parentKind) : rootAllowedKinds(pattern);
    // 自種別は常に表示（既存ノードの再選択・現在地の明示）。許可集合に無ければ先頭へ。
    const set = new Set<IssueNodeKind>(allowed);
    set.add(kind);
    // 元の種別並び（ISSUE_NODE_KINDS）を保ちつつ、許可された種別だけに絞る。
    return KIND_OPTIONS.filter((k) => set.has(k));
  }, [showAllKinds, parentKind, pattern, kind]);

  // METRIC の数値（metadata.value に保持）。
  const initialMetric =
    node.metadata?.value != null ? `${node.metadata.value}` : '';
  const [metricValue, setMetricValue] = useState(initialMetric);

  // パネルを開いた（=ノードを選択した）ら、そのノードの紐づくタスクを取得する。
  useEffect(() => {
    onLoadTasks(node.id);
  }, [node.id, onLoadTasks]);

  const showVerify = cfg.affordance === 'verification';
  const showReco = cfg.affordance === 'recommendation';
  const showMetric = cfg.affordance === 'metric';

  return (
    <Card className="absolute inset-y-0 right-0 z-30 w-full overflow-y-auto border-gray-200 bg-white shadow-xl sm:static sm:z-auto sm:w-80 sm:shrink-0 sm:shadow-none">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900">ノードを編集</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 種別（親種別で許可された子種別＋自種別に絞る。トグルで全 kind=取り違え救済） */}
        <div>
          <div className="mb-1 flex items-center gap-1.5">
            <label className="block text-xs font-medium text-gray-500">種別</label>
            <HelpTooltip text="ノードの種別です。生やす基（親ノード）の種別で選べる子種別が決まります。取り違えの修正は「全種別を表示」で全11種別から選べます（配置は強制されません）。" />
          </div>
          <div
            className={`mb-1 inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium ${cfg.chip} border-transparent`}
          >
            {cfg.flowLabel}
          </div>
          {/* 現在種別の説明（各選択肢はホバーで title 表示。ここは現在の種別の説明を常時表示）。 */}
          <p className="mb-1.5 text-[11px] leading-snug text-gray-500">{cfg.description}</p>
          <div className="grid grid-cols-3 gap-1">
            {kindOptions.map((k) => {
              const active = k === kind;
              const Icon = KIND_ICON[k];
              const kc = KIND_CONFIG[k];
              return (
                <button
                  key={k}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (k !== kind) onPatch(node.id, { kind: k });
                  }}
                  title={`${kc.label}: ${kc.description}`}
                  className={`flex items-center justify-center gap-1 rounded border px-1 py-1.5 text-[10px] font-medium transition ${
                    active
                      ? `${kc.chip} border-transparent ring-1 ring-inset ring-gray-300`
                      : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <Icon className="h-3 w-3 shrink-0" />
                  {kc.label}
                </button>
              );
            })}
          </div>
          {/* 取り違え救済: 全種別を表示トグル（既定OFF=親種別で制限） */}
          <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-500">
            <input
              type="checkbox"
              checked={showAllKinds}
              onChange={(e) => setShowAllKinds(e.target.checked)}
              className="h-3 w-3"
            />
            全種別を表示（取り違えの修正用）
          </label>
        </div>

        {/* ラベル */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">ラベル</label>
          <Textarea
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => {
              const v = label.trim();
              if (v && v !== node.label) onPatch(node.id, { label: v });
              else setLabel(node.label);
            }}
            rows={2}
            className="resize-none text-sm"
          />
        </div>

        {/* 検証状態（仕掛け: CAUSE/POINT/HYPOTHESIS/VERIFICATION/RESULT。強制しない） */}
        {showVerify && (
          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <label className="block text-xs font-medium text-gray-500">検証状態</label>
              <HelpTooltip text="どれだけ確からしいかの記録です。○確定＝裏付けあり／×否定／△未確認／?要ヒアリング。検証結果(RESULT)は上位の論点へ集約されます。" />
            </div>
            <div className="grid grid-cols-2 gap-1">
              {VERIFY_OPTIONS.map((v) => {
                const active = v === (node.verification ?? 'NA');
                return (
                  <button
                    key={v}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (v !== node.verification) onSetVerification(node.id, v);
                    }}
                    className={`rounded border px-2 py-1 text-[11px] font-medium transition ${
                      active ? VERIFY_META[v].cls : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {VERIFY_META[v].label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 推奨（仕掛け: OPTION/COUNTERMEASURE。強制しない） */}
        {showReco && (
          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <label className="block text-xs font-medium text-gray-500">推奨</label>
              <HelpTooltip text="打ち手候補を採用するかの判断です。採用＝実行する／保留＝判断待ち／不採用＝見送り。効果とコストを踏まえて取捨選択します。" />
            </div>
            <div className="grid grid-cols-2 gap-1">
              {RECO_OPTIONS.map((r) => {
                const active = r === (node.recommendation ?? 'NA');
                return (
                  <button
                    key={r}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (r !== node.recommendation) onPatch(node.id, { recommendation: r });
                    }}
                    className={`rounded border px-2 py-1 text-[11px] font-medium transition ${
                      active ? RECO_META[r].cls : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {RECO_META[r].label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 数値（仕掛け: METRIC。metadata.value に保持） */}
        {showMetric && (
          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <label className="block text-xs font-medium text-gray-500">数値（目標/実績）</label>
              <HelpTooltip text="このKPIの数値です（例: 12%, 1.2億円, 350件）。metadata に保持され、ノード上に表示されます。" />
            </div>
            <Input
              value={metricValue}
              onChange={(e) => setMetricValue(e.target.value)}
              onBlur={() => {
                const v = metricValue.trim();
                if (v !== initialMetric) {
                  const nextMeta = { ...(node.metadata ?? {}), value: v || null };
                  onPatch(node.id, { metadata: nextMeta });
                }
              }}
              placeholder="例: 12% / 1.2億円 / 350件"
              className="text-sm"
            />
          </div>
        )}

        {/* 根拠 */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">根拠 / メモ</label>
          <Textarea
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            onBlur={() => {
              const v = evidence.trim();
              if (v !== (node.evidence ?? '')) onPatch(node.id, { evidence: v || null });
            }}
            rows={3}
            placeholder="検証根拠・出典など"
            className="resize-none text-sm"
          />
        </div>

        {/* タスク連携（CAUSE=調査 / COUNTERMEASURE=実行） */}
        {flavor && (
          <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <flavor.icon className="h-3.5 w-3.5 text-gray-500" />
              <span className="text-xs font-semibold text-gray-700">紐づくタスク</span>
              {linkedTasks.length > 0 && (
                <span className="rounded-full bg-gray-200 px-1.5 text-[10px] font-medium text-gray-600">
                  {linkedTasks.length}
                </span>
              )}
              <HelpTooltip
                text={
                  kind === 'CAUSE'
                    ? 'この「なぜ（原因）」を確かめるための調査タスクを作成・確認します。掘り下げた原因を「調べて確定させる」流れです。'
                    : 'この「打ち手（対策）」を実行に移すためのタスクを作成・確認します。採用した打ち手を「実行に落とす」流れです。'
                }
              />
            </div>

            {linkedTasks.length === 0 ? (
              <p className="mb-2 text-[11px] text-gray-400">
                まだタスクはありません。下のボタンで{flavor.titlePrefix}タスクを作成できます。
              </p>
            ) : (
              <ul className="mb-2 space-y-1.5">
                {linkedTasks.map((t) => {
                  const st = taskStatusLabels[t.status];
                  return (
                    <li key={t.id}>
                      <Link
                        href={`../../tasks/${t.id}`}
                        className="group flex items-center gap-1.5 rounded border border-gray-200 bg-white px-2 py-1.5 text-[11px] hover:border-blue-300 hover:bg-blue-50/40"
                      >
                        <span
                          className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${st?.color ?? 'border-gray-200 bg-gray-100 text-gray-600'}`}
                        >
                          {st?.label ?? t.status}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-gray-800 group-hover:text-blue-700">
                          {t.title}
                        </span>
                        <span className="shrink-0 tabular-nums text-gray-400">{t.progress}%</span>
                        <ExternalLink className="h-3 w-3 shrink-0 text-gray-300 group-hover:text-blue-500" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}

            <Button
              size="sm"
              variant="outline"
              disabled={busy || creatingTask}
              onClick={() => onCreateTask(node)}
              className={`w-full ${flavor.chip}`}
            >
              {creatingTask ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  作成中...
                </>
              ) : (
                <>
                  <Plus className="mr-1 h-4 w-4" />
                  {flavor.verb}
                </>
              )}
            </Button>
            {linkedTasks.length > 0 && (
              <Link
                href={`../../tasks?issueNodeId=${node.id}`}
                className="mt-1.5 block text-center text-[11px] text-blue-600 hover:underline"
              >
                タスク一覧で開く
              </Link>
            )}
          </div>
        )}

        {/* 子ノードを増やす導線（AI候補生成 / 例の挿入 / 発想法） */}
        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-gray-700">子ノードを増やす</span>
            <HelpTooltip text="このノードの下に子ノードを足す3つの方法です。AIで候補生成＝文脈に沿った候補を生成AIが提案／例を挿入＝このパターンの開始例を取り込む／発想法で分解＝IPLoT発想法のレンズで分解。" />
          </div>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => onAiSuggest(node.id)}
            className="w-full bg-violet-600 text-white hover:bg-violet-700"
          >
            <Wand2 className="mr-1 h-4 w-4" />
            AIで候補生成
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onInsertExample(node.id)}
            className="w-full border-amber-200 text-amber-700 hover:bg-amber-50"
            title={`「${patternLabel}」の開始例を子ノードに追加（${exampleCount}件）`}
          >
            <ListPlus className="mr-1 h-4 w-4" />
            例を挿入（{exampleCount}件）
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onIdeate(node.id)}
            className="w-full border-blue-200 text-blue-700 hover:bg-blue-50"
          >
            <Sparkles className="mr-1 h-4 w-4" />
            発想法で分解
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => onDelete(node.id)}
          className="w-full border-red-200 text-red-600 hover:bg-red-50"
        >
          <Trash2 className="mr-1 h-4 w-4" />
          このノードを削除
        </Button>
      </CardContent>
    </Card>
  );
}

export default function IssueTreeDetailPage() {
  return (
    <ReactFlowProvider>
      <IssueTreeMindMap />
    </ReactFlowProvider>
  );
}
