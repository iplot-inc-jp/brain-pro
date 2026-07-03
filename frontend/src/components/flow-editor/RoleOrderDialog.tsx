'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd';
import { GripVertical, Loader2, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { rolesApi } from '@/lib/api';

/** 並び替えに必要な最小限のロール形（api.Role / flow-types.Role の双方を受ける）。 */
type ReorderRole = { id: string; name: string; color?: string | null };

/**
 * 業務フローのレーン（ロール）の順番を並び替えるダイアログ。
 * ドラッグ または 上下矢印で並べ替え、保存で PUT /roles/project/:projectId/order。
 * 上にあるものほど最初（order 小）のレーンになる。
 */
export function RoleOrderDialog({
  projectId,
  roles,
  open,
  onOpenChange,
  onReordered,
}: {
  projectId: string;
  roles: ReorderRole[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReordered: () => void;
}) {
  const [items, setItems] = useState<ReorderRole[]>(roles);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 開くたびに最新の roles で初期化
  useEffect(() => {
    if (open) {
      setItems(roles);
      setError('');
    }
  }, [open, roles]);

  function move(from: number, to: number) {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    setItems(next);
  }

  function onDragEnd(result: DropResult) {
    if (!result.destination) return;
    move(result.source.index, result.destination.index);
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      await rolesApi.updateOrder(
        projectId,
        items.map((r) => r.id),
      );
      onReordered();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '並び順の保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-gray-200 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-gray-900">レーン（ロール）の順番</DialogTitle>
          <DialogDescription className="text-gray-500">
            ドラッグ、または上下の矢印で並び替えます。上にあるほど最初のレーンになります。
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-2 rounded bg-red-50 border border-red-200 text-red-600 text-sm">
            {error}
          </div>
        )}

        {items.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">ロールがありません。</p>
        ) : (
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="role-order">
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="space-y-1.5 max-h-[50vh] overflow-y-auto pr-1"
                >
                  {items.map((r, i) => (
                    <Draggable key={r.id} draggableId={r.id} index={i}>
                      {(p, snapshot) => {
                        const row = (
                        <div
                          ref={p.innerRef}
                          {...p.draggableProps}
                          style={p.draggableProps.style as CSSProperties}
                          className={
                            'flex items-center gap-2 rounded-lg border px-3 py-2 bg-white ' +
                            (snapshot.isDragging
                              ? 'border-blue-400 shadow-md'
                              : 'border-gray-200')
                          }
                        >
                          <span
                            {...p.dragHandleProps}
                            className="text-gray-400 cursor-grab active:cursor-grabbing"
                            title="ドラッグで並び替え"
                          >
                            <GripVertical className="h-4 w-4" />
                          </span>
                          <span
                            className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: r.color || '#94a3b8' }}
                          />
                          <span className="flex-1 truncate text-sm text-gray-900">{r.name}</span>
                          <span className="text-xs text-gray-400 w-5 text-right tabular-nums">
                            {i + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => move(i, i - 1)}
                            disabled={i === 0}
                            title="上へ"
                            className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => move(i, i + 1)}
                            disabled={i === items.length - 1}
                            title="下へ"
                            className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                        </div>
                        );
                        // Radix Dialog は中央寄せに transform を使うため、ドラッグ中の
                        // position:fixed がその transform 基準になり項目が画面外へ飛んで
                        // 消える。ドラッグ中だけ body へポータルして transform から逃がす。
                        return snapshot.isDragging && typeof document !== 'undefined'
                          ? createPortal(row, document.body)
                          : row;
                      }}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-gray-300 text-gray-700"
          >
            キャンセル
          </Button>
          <Button onClick={save} disabled={saving || items.length === 0} className="bg-blue-600 hover:bg-blue-700">
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
