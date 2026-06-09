'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FlowData } from '@/components/flow-editor/flow-types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

// ローカルに積むスタックの上限（spec: 直近 N=50）。
const MAX_STACK = 50;
// 連続操作（ドラッグ等）を 1 スナップショットに集約する debounce。
const CAPTURE_DEBOUNCE_MS = 400;

// ===========================================
// スナップショット型（restore の body と同形 = 正規化した flowData）
// ===========================================

export type SnapshotNodeLink = {
  informationTypeId: string;
  direction: 'INPUT' | 'OUTPUT';
  order?: number;
};

export type SnapshotNode = {
  id: string;
  type?: string;
  label: string;
  positionX?: number;
  positionY?: number;
  order?: number;
  roleId?: string | null;
  processingTime?: string | null;
  handledCount?: string | null;
  supplement?: string | null;
  metadata?: Record<string, unknown>;
  childFlowId?: string | null;
  informationLinks?: SnapshotNodeLink[];
};

export type SnapshotEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
  condition?: string;
  informationTypeId?: string | null;
  pathStyle?: string | null;
  labelT?: number | null;
  infoT?: number | null;
};

export type FlowSnapshotData = {
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
};

type PersistedStack = {
  stack: FlowSnapshotData[];
  index: number;
};

// DB スナップショット履歴（GET /snapshots）の1件。
type DbSnapshot = {
  id: string;
  seq: number;
  label: string | null;
  data: unknown;
  createdAt: string;
};

// ===========================================
// 正規化: 現在の flowData → restore body と同形のスナップショット
// ===========================================
export function serializeSnapshot(flowData: FlowData): FlowSnapshotData {
  const nodes: SnapshotNode[] = (flowData.nodes ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    label: n.label,
    positionX: n.positionX,
    positionY: n.positionY,
    order: n.order,
    roleId: n.roleId ?? n.role?.id ?? null,
    processingTime: n.processingTime ?? null,
    handledCount: n.handledCount ?? null,
    supplement: n.supplement ?? null,
    metadata: n.metadata,
    childFlowId: n.childFlowId ?? null,
    informationLinks: (n.informationLinks ?? []).map((l) => ({
      informationTypeId: l.informationTypeId,
      direction: l.direction,
      order: l.order,
    })),
  }));

  const edges: SnapshotEdge[] = (flowData.edges ?? []).map((e) => ({
    id: e.id,
    sourceNodeId: e.sourceNodeId,
    targetNodeId: e.targetNodeId,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
    label: e.label,
    condition: e.condition,
    informationTypeId: e.informationTypeId ?? null,
    pathStyle: e.pathStyle ?? null,
    labelT: e.labelT ?? null,
    infoT: e.infoT ?? null,
  }));

  return { nodes, edges };
}

// 2 スナップショットが等価か（捕捉ループ・無変化 push の抑止用）。
// 安定したキー順で文字列化して比較する（serializeSnapshot がキー順を固定するので JSON で十分）。
function snapshotsEqual(a: FlowSnapshotData, b: FlowSnapshotData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface UseFlowUndoRedoOptions {
  /** 現在のフロー ID（切替で履歴を読み直す）。 */
  flowId: string | null;
  /** 現在のフロー状態（捕捉対象）。 */
  flowData: FlowData | null;
  /** 認可ヘッダ（page 側の getHeaders を共用）。 */
  getHeaders: () => Record<string, string>;
  /**
   * restore 後にフル状態を再取得する（page 側の fetchFlowData）。
   * isRestoring=true の間は捕捉 useEffect が push しないようにフラグを立てる。
   */
  refetch: (id: string) => Promise<void> | void;
}

export interface UseFlowUndoRedoResult {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** restore 由来の再取得中フラグ（capture を抑止する間 true）。 */
  isRestoring: boolean;
}

// ===========================================
// useFlowUndoRedo: スナップショット型 Undo/Redo フック
// - state stack: FlowSnapshotData[] + index
// - localStorage `flow-undo-<flowId>` に {stack,index} を保存/復元
// - 初回ロードで GET /snapshots（DB 履歴）→ スタック復元（無ければ現在状態を baseline=index0）
// - flowData の変化を監視し、確定操作後に新スナップを push（redo 分破棄）→ localStorage + POST /snapshots
//   連続操作は debounce(~400ms)で集約。Undo/Redo 由来の再取得（isRestoring 中）は push しない。
// - undo/redo: index を進退 → PUT /restore(stack[index]) → refetch(isRestoring)
// ===========================================
export function useFlowUndoRedo(
  options: UseFlowUndoRedoOptions,
): UseFlowUndoRedoResult {
  const { flowId, flowData, getHeaders, refetch } = options;

  const [stack, setStack] = useState<FlowSnapshotData[]>([]);
  const [index, setIndex] = useState(0);

  // restore→refetch の間 true。capture useEffect はこの間 push しない。
  const isRestoringRef = useRef(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // DB 履歴のロード/初回 baseline 確立が済んだフロー ID（再 hydrate の二重実行防止）。
  const hydratedFlowIdRef = useRef<string | null>(null);
  // 現在 stack が属するフロー ID。フロー切替直後にこれと flowId がズレている間は
  // 捕捉/undo/redo を止め、別フローの flowData を取り違えて push しないようにする。
  const stackFlowIdRef = useRef<string | null>(null);
  // capture の debounce タイマ。
  const captureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // stack/index の最新値を捕捉ロジックから参照するための ref（依存配列を増やさない）。
  const stackRef = useRef<FlowSnapshotData[]>(stack);
  const indexRef = useRef(index);
  stackRef.current = stack;
  indexRef.current = index;

  const storageKey = useMemo(
    () => (flowId ? `flow-undo-${flowId}` : null),
    [flowId],
  );

  // ---- localStorage 保存 ----
  const persist = useCallback(
    (nextStack: FlowSnapshotData[], nextIndex: number) => {
      if (!storageKey) return;
      try {
        const payload: PersistedStack = {
          stack: nextStack.slice(-MAX_STACK),
          index: Math.min(nextIndex, nextStack.length - 1),
        };
        localStorage.setItem(storageKey, JSON.stringify(payload));
      } catch {
        /* localStorage 不可は致命ではない（メモリ内スタックは生きる） */
      }
    },
    [storageKey],
  );

  // ---- DB へ履歴を1件追加（POST /snapshots） ----
  const postSnapshot = useCallback(
    async (snap: FlowSnapshotData, label?: string) => {
      if (!flowId) return;
      try {
        const res = await fetch(
          `${API_URL}/api/business-flows/${flowId}/snapshots`,
          {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ label: label ?? null, data: snap }),
          },
        );
        if (!res.ok) throw new Error('Failed to post snapshot');
      } catch (err) {
        console.error('Failed to post flow snapshot:', err);
      }
    },
    [flowId, getHeaders],
  );

  // ---- restore（PUT /restore）→ refetch（isRestoring 中は capture 抑止） ----
  const applyRestore = useCallback(
    async (snap: FlowSnapshotData) => {
      if (!flowId) return;
      isRestoringRef.current = true;
      setIsRestoring(true);
      try {
        const res = await fetch(
          `${API_URL}/api/business-flows/${flowId}/restore`,
          {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify({ nodes: snap.nodes, edges: snap.edges }),
          },
        );
        if (!res.ok) throw new Error('Failed to restore flow');
        await refetch(flowId);
      } catch (err) {
        console.error('Failed to restore flow snapshot:', err);
      } finally {
        // refetch による flowData 更新で走る capture useEffect を一度通してから解除する。
        // microtask ではなく次フレームで落とすことで、その変化を確実に無視させる。
        setTimeout(() => {
          isRestoringRef.current = false;
          setIsRestoring(false);
        }, 0);
      }
    },
    [flowId, getHeaders, refetch],
  );

  // ===========================================
  // フロー切替時の同期リセット
  //  - stack を即時に空へ戻し、hydrate/baseline を新フロー用に再走させる。
  //  - 進行中の debounce 捕捉も破棄（旧フローの flowData を新スタックへ混ぜない）。
  // ===========================================
  useEffect(() => {
    stackFlowIdRef.current = flowId;
    hydratedFlowIdRef.current = null;
    if (captureTimerRef.current) {
      clearTimeout(captureTimerRef.current);
      captureTimerRef.current = null;
    }
    setStack([]);
    setIndex(0);
    stackRef.current = [];
    indexRef.current = 0;
  }, [flowId]);

  // ===========================================
  // フロー切替 / 初回ロード: DB 履歴 → スタック復元
  //  - localStorage に保存済みスタックがあればまずそれを採用（オフライン高速）
  //  - DB に履歴があれば DB を優先（リロード/別端末でも残る）。現在位置=末尾。
  //  - どちらも無ければ baseline は最初の flowData 捕捉時に確立する（index=0）。
  // ===========================================
  useEffect(() => {
    if (!flowId) return;
    if (hydratedFlowIdRef.current === flowId) return;

    let cancelled = false;

    const hydrate = async () => {
      // 1) localStorage から（あれば即時復元）
      let restored = false;
      try {
        const raw = storageKey ? localStorage.getItem(storageKey) : null;
        if (raw) {
          const parsed = JSON.parse(raw) as PersistedStack;
          if (
            parsed &&
            Array.isArray(parsed.stack) &&
            parsed.stack.length > 0
          ) {
            const s = parsed.stack.slice(-MAX_STACK);
            const i = Math.min(
              Math.max(parsed.index ?? s.length - 1, 0),
              s.length - 1,
            );
            if (!cancelled) {
              setStack(s);
              setIndex(i);
              restored = true;
            }
          }
        }
      } catch {
        /* noop */
      }

      // 2) DB 履歴を読む（直近 N を seq 昇順）。あればこちらを優先採用。
      try {
        const res = await fetch(
          `${API_URL}/api/business-flows/${flowId}/snapshots?limit=${MAX_STACK}`,
          { headers: getHeaders() },
        );
        if (res.ok) {
          const rows = (await res.json()) as DbSnapshot[];
          if (!cancelled && Array.isArray(rows) && rows.length > 0) {
            const dbStack = rows
              .map((r) => r.data as FlowSnapshotData)
              .filter(
                (d): d is FlowSnapshotData =>
                  !!d && Array.isArray(d.nodes) && Array.isArray(d.edges),
              );
            if (dbStack.length > 0) {
              setStack(dbStack);
              setIndex(dbStack.length - 1);
              persist(dbStack, dbStack.length - 1);
              restored = true;
            }
          }
        }
      } catch {
        /* DB 履歴の取得失敗は致命ではない（localStorage / baseline にフォールバック） */
      }

      if (!cancelled) {
        // どちらも無ければ baseline は capture useEffect が最初の flowData で確立する。
        hydratedFlowIdRef.current = restored ? flowId : null;
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
    // storageKey は flowId に従属。getHeaders/persist は安定。
  }, [flowId, storageKey, getHeaders, persist]);

  // ===========================================
  // 捕捉: flowData の変化を監視して新スナップを push
  //  - isRestoring 中（undo/redo 由来の refetch）はスキップ
  //  - 初回（スタック空）は baseline として 1 回だけ index=0 で確立（POST しない）
  //  - 変化が無ければ（同値）push しない
  //  - 連続操作は debounce(~400ms)で集約
  // ===========================================
  useEffect(() => {
    if (!flowId || !flowData) return;
    if (isRestoringRef.current) return; // restore 由来の再取得は捕捉しない
    // flowData が現在のフローのものか（切替直後のリセット完了後）を確認。
    if (stackFlowIdRef.current !== flowId) return;
    if (flowData.id !== flowId) return; // refetch 中で別フローの残骸が来ても無視

    const snap = serializeSnapshot(flowData);

    // baseline 未確立（スタック空）→ 即時に index=0 で baseline 化（POST しない）。
    if (stackRef.current.length === 0) {
      setStack([snap]);
      setIndex(0);
      persist([snap], 0);
      hydratedFlowIdRef.current = flowId;
      return;
    }

    // 現在位置のスナップと同値なら何もしない（refetch ループ・冪等操作の抑止）。
    const current = stackRef.current[indexRef.current];
    if (current && snapshotsEqual(current, snap)) return;

    // debounce で集約（連続ドラッグ等を 1 スナップに）。
    if (captureTimerRef.current) clearTimeout(captureTimerRef.current);
    captureTimerRef.current = setTimeout(() => {
      if (isRestoringRef.current) return;
      const base = stackRef.current.slice(0, indexRef.current + 1);
      const last = base[base.length - 1];
      if (last && snapshotsEqual(last, snap)) return; // 二重抑止

      const next = [...base, snap].slice(-MAX_STACK);
      const nextIndex = next.length - 1;
      setStack(next);
      setIndex(nextIndex);
      persist(next, nextIndex);
      void postSnapshot(snap);
    }, CAPTURE_DEBOUNCE_MS);

    return () => {
      if (captureTimerRef.current) clearTimeout(captureTimerRef.current);
    };
  }, [flowId, flowData, persist, postSnapshot]);

  // ---- Undo / Redo ----
  const undo = useCallback(() => {
    if (isRestoringRef.current) return;
    if (indexRef.current <= 0) return; // 端は no-op
    const nextIndex = indexRef.current - 1;
    const snap = stackRef.current[nextIndex];
    if (!snap) return;
    setIndex(nextIndex);
    persist(stackRef.current, nextIndex);
    void applyRestore(snap);
  }, [persist, applyRestore]);

  const redo = useCallback(() => {
    if (isRestoringRef.current) return;
    if (indexRef.current >= stackRef.current.length - 1) return; // 端は no-op
    const nextIndex = indexRef.current + 1;
    const snap = stackRef.current[nextIndex];
    if (!snap) return;
    setIndex(nextIndex);
    persist(stackRef.current, nextIndex);
    void applyRestore(snap);
  }, [persist, applyRestore]);

  const canUndo = index > 0;
  const canRedo = index < stack.length - 1;

  return { canUndo, canRedo, undo, redo, isRestoring };
}
