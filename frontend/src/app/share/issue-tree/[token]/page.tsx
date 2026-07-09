'use client';

/**
 * イシューツリーの共有閲覧ページ（/share/issue-tree/:token）。
 *
 * - データは GET /api/shared/issue-tree/:token（@Public。scope=ORG はサーバが検証）。
 * - 編集ページ（ReactFlowエディタ）は編集機能と密結合なため、閲覧は
 *   軽量な自前ツリービューア（左→右レイアウト＋SVG接続線）で描画する。
 *   ノード色・種別ラベルは編集ページと同じ KIND_CONFIG を共有し見た目を揃える。
 * - ホイールでズーム、背景ドラッグでパンできる（ベクタ描画なので拡大しても劣化しない）。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useParams } from 'next/navigation';
import { HelpCircle } from 'lucide-react';
import {
  KIND_CONFIG,
  PATTERN_META,
  type IssueNodeKind,
  type IssueTreePattern,
} from '@/lib/issue-tree-patterns';
import {
  layoutTree,
  TREE_NODE_W as NODE_W,
  TREE_NODE_H as NODE_H,
  TREE_COL_W as COL_W,
  TREE_ROW_H as ROW_H,
  TREE_ROOT_ID as ROOT_ID,
} from '@/lib/issue-tree-view-layout';
import { SharedViewShell } from '@/components/share/SharedViewShell';
import { fetchSharedView, SharedViewError } from '@/lib/share-view';

interface SharedNode {
  id: string;
  parentId: string | null;
  depth: number;
  order: number;
  label: string;
  kind: IssueNodeKind;
  verification: string;
  recommendation: string;
  evidence: string | null;
}

interface SharedIssueTreeResponse {
  id: string;
  projectId: string;
  pattern: IssueTreePattern;
  name: string;
  rootQuestion: string | null;
  nodes: SharedNode[];
  projectName: string | null;
}

/** 検証（○×△）バッジ。NA は出さない。 */
const VERIFICATION_BADGES: Record<string, { label: string; cls: string }> = {
  CONFIRMED: { label: '○ 確定', cls: 'bg-emerald-100 text-emerald-700' },
  REJECTED: { label: '× 否定', cls: 'bg-red-100 text-red-700' },
  UNKNOWN: { label: '△ 不明', cls: 'bg-amber-100 text-amber-700' },
  NEEDS_HEARING: { label: '要ヒアリング', cls: 'bg-orange-100 text-orange-700' },
};

/** 採否バッジ。NA は出さない。 */
const RECOMMENDATION_BADGES: Record<string, { label: string; cls: string }> = {
  ADOPT: { label: '採用', cls: 'bg-blue-100 text-blue-700' },
  HOLD: { label: '保留', cls: 'bg-gray-100 text-gray-600' },
  REJECT: { label: '不採用', cls: 'bg-gray-200 text-gray-500' },
};

export default function SharedIssueTreePage() {
  const params = useParams();
  const token = params.token as string;

  const [data, setData] = useState<SharedIssueTreeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<SharedViewError | null>(null);

  // ビュー変換（パン/ズーム）
  const [view, setView] = useState({ x: 40, y: 40, k: 1 });
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const body = await fetchSharedView<SharedIssueTreeResponse>(
          `/api/shared/issue-tree/${token}`,
        );
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof SharedViewError
              ? err
              : new SharedViewError('error', '読み込みに失敗しました'),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const layout = useMemo(
    () => (data ? layoutTree(data.nodes) : null),
    [data],
  );

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setView((v) => {
      const k = Math.min(2.5, Math.max(0.2, v.k * (e.deltaY < 0 ? 1.1 : 0.9)));
      return { ...v, k };
    });
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      dragRef.current = { startX: e.clientX, startY: e.clientY, ox: view.x, oy: view.y };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [view.x, view.y],
  );
  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setView((v) => ({ ...v, x: d.ox + (e.clientX - d.startX), y: d.oy + (e.clientY - d.startY) }));
  }, []);
  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const patternLabel = data ? PATTERN_META[data.pattern]?.label ?? '' : '';

  return (
    <SharedViewShell
      title={data?.name ?? 'イシューツリー'}
      subtitle={[data?.projectName, patternLabel].filter(Boolean).join(' / ')}
      loading={loading}
      error={error}
    >
      {data && layout && (
        <div
          className="h-full w-full cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <div
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
              transformOrigin: '0 0',
              width: layout.width,
              height: layout.height,
              position: 'relative',
            }}
          >
            {/* 接続線（親の右端 → 子の左端のベジェ） */}
            <svg
              width={layout.width + COL_W}
              height={layout.height + ROW_H}
              className="pointer-events-none absolute left-0 top-0"
            >
              {layout.edges.map((e, i) => {
                const x1 = e.from.x + NODE_W;
                const y1 = e.from.y + NODE_H / 2;
                const x2 = e.to.x;
                const y2 = e.to.y + NODE_H / 2;
                const mx = (x1 + x2) / 2;
                return (
                  <path
                    key={i}
                    d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke="#cbd5e1"
                    strokeWidth={1.5}
                  />
                );
              })}
            </svg>

            {/* ノードカード */}
            {layout.placed.map((p) => {
              if (p.node === null) {
                // 仮想ルート（ツリー名＋ルートの問い）
                return (
                  <div
                    key={ROOT_ID}
                    className="absolute rounded-lg border-2 border-indigo-300 bg-indigo-50 px-3 py-2 shadow-sm"
                    style={{ left: p.x, top: p.y, width: NODE_W, minHeight: NODE_H }}
                  >
                    <div className="flex items-center gap-1 text-[10px] font-semibold text-indigo-500">
                      <HelpCircle className="h-3 w-3" />
                      {patternLabel || 'ツリー'}
                    </div>
                    <p className="mt-0.5 line-clamp-3 text-xs font-bold text-indigo-900">
                      {data.rootQuestion || data.name}
                    </p>
                  </div>
                );
              }
              const cfg = KIND_CONFIG[p.node.kind];
              const v = VERIFICATION_BADGES[p.node.verification];
              const r = RECOMMENDATION_BADGES[p.node.recommendation];
              return (
                <div
                  key={p.node.id}
                  className={`absolute overflow-hidden rounded-lg border bg-white shadow-sm ${cfg?.border ?? 'border-gray-300'}`}
                  style={{ left: p.x, top: p.y, width: NODE_W, minHeight: NODE_H }}
                  title={p.node.evidence ? `根拠: ${p.node.evidence}` : undefined}
                >
                  {/* 種別カラーバー */}
                  <div className={`h-1 w-full ${cfg?.bar ?? 'bg-gray-400'}`} />
                  <div className="px-2.5 py-1.5">
                    <div className="flex flex-wrap items-center gap-1">
                      <span
                        className={`rounded px-1 py-0.5 text-[9px] font-semibold leading-none ${cfg?.chip ?? 'bg-gray-100 text-gray-600'}`}
                      >
                        {cfg?.label ?? p.node.kind}
                      </span>
                      {v && (
                        <span className={`rounded px-1 py-0.5 text-[9px] leading-none ${v.cls}`}>
                          {v.label}
                        </span>
                      )}
                      {r && (
                        <span className={`rounded px-1 py-0.5 text-[9px] leading-none ${r.cls}`}>
                          {r.label}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-gray-800">
                      {p.node.label}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </SharedViewShell>
  );
}
