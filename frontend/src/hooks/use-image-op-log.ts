'use client';

// 業務フローキャンバスの画像要素(DiagramElement)の Undo/Redo を、スナップショットではなく
// 操作ログ（op-log）で管理するフック。各ジェスチャ（作成/移動/リサイズ/削除）が「順操作(do)」と
// 「逆操作(undo)」のペアを記録し、undo/redo はそのペアをローカルへ純粋適用(applyDelta)しつつ
// 冪等な applyOps でサーバへ反映する。スナップショット比較・全件再取得・isRestoring 窓・jsonb
// キー順といった脆い機構を一切持たないため、設計上 race を生まない（applyDelta は純粋関数で
// ユニットテスト可能）。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  diagramElementApi,
  type DiagramElementDto,
  type DiagramElementOp,
} from '@/lib/diagram-elements';
import { nextUndoSeq } from './undo-seq';
import { applyDelta } from './image-op-delta';

// 純粋リデューサは ./image-op-delta から再エクスポート（node 環境の vitest 用に分離している）。
export { applyDelta };

const MAX_OPS = 50;

interface OpEntry {
  do: DiagramElementOp;
  undo: DiagramElementOp;
  seq: number;
}

/** 親（page）が ⌘Z ルーターから画像Undoを駆動するための命令的ハンドル。 */
export interface ImageUndoApi {
  undo: () => void;
  redo: () => void;
  /** undo で取り消される操作の seq（無ければ null）。 */
  peekUndoSeq: () => number | null;
  /** redo で再適用される操作の seq（無ければ null）。 */
  peekRedoSeq: () => number | null;
}

export interface UseImageOpLogResult extends ImageUndoApi {
  /** ジェスチャ確定時に順操作と逆操作を記録する（操作自体は呼び出し側が既に適用済み）。 */
  recordImageOp: (doOp: DiagramElementOp, undoOp: DiagramElementOp) => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useImageOpLog(params: {
  projectId?: string;
  diagramId: string;
  setImageElements: Dispatch<SetStateAction<DiagramElementDto[]>>;
}): UseImageOpLogResult {
  const { projectId, diagramId, setImageElements } = params;
  // past/future は ref で保持（ルーターの peek* が常に最新を読む）。UI 用の真偽は force で再描画。
  const pastRef = useRef<OpEntry[]>([]);
  const futureRef = useRef<OpEntry[]>([]);
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);

  // フロー切替（diagramId 変更）で op-log を破棄する。SwimlaneCanvasInner はドリルダウンで
  // 再マウントされず diagramId だけが変わるため、これをしないと別フローの操作を取り消してしまう。
  useEffect(() => {
    pastRef.current = [];
    futureRef.current = [];
    rerender();
  }, [diagramId, rerender]);

  // 1 op をローカル(applyDelta)＋サーバ(applyOps 冪等)へ反映。サーバ失敗はログのみ（ローカルは反映済み）。
  const apply = useCallback(
    (op: DiagramElementOp) => {
      setImageElements((prev) => applyDelta(prev, op));
      if (projectId) {
        void diagramElementApi
          .applyOps(projectId, 'FLOW', diagramId, [op])
          .catch((e) => console.warn('[image-undo] applyOps failed', e));
      }
    },
    [projectId, diagramId, setImageElements],
  );

  const recordImageOp = useCallback(
    (doOp: DiagramElementOp, undoOp: DiagramElementOp) => {
      pastRef.current.push({ do: doOp, undo: undoOp, seq: nextUndoSeq() });
      if (pastRef.current.length > MAX_OPS) pastRef.current.shift();
      futureRef.current = []; // 新規操作で redo 分岐は破棄。
      rerender();
    },
    [rerender],
  );

  const undo = useCallback(() => {
    const entry = pastRef.current.pop();
    if (!entry) return;
    apply(entry.undo);
    futureRef.current.push(entry);
    rerender();
  }, [apply, rerender]);

  const redo = useCallback(() => {
    const entry = futureRef.current.pop();
    if (!entry) return;
    apply(entry.do);
    pastRef.current.push(entry);
    rerender();
  }, [apply, rerender]);

  return {
    recordImageOp,
    undo,
    redo,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    peekUndoSeq: () =>
      pastRef.current.length ? pastRef.current[pastRef.current.length - 1].seq : null,
    peekRedoSeq: () =>
      futureRef.current.length ? futureRef.current[futureRef.current.length - 1].seq : null,
  };
}
