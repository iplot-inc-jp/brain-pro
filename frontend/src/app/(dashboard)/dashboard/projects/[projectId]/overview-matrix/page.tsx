'use client';

/**
 * 俯瞰思考（俯瞰マトリクス）一覧ページ。
 * プロジェクトの汎用 N 軸マトリクス（v1 は最大 3 軸）を一覧し、新規作成 / 複製 / 削除する。
 * 新規作成は API が 2 軸の空ひな形を生成 → 編集ルートへ遷移する。
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { useReadOnly } from '@/components/read-only-context';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Loader2,
  Plus,
  Trash2,
  Copy,
  ChevronRight,
  TableProperties,
} from 'lucide-react';
import {
  overviewMatrixApi,
  type OverviewMatrixSummary,
} from '@/lib/overview-matrix';

const CELL_MODE_LABEL: Record<string, string> = {
  TEXT: '自由記述',
  TAGS: 'タグ',
  SYMBOL: '記号',
};

export default function OverviewMatrixListPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const { canEdit } = useReadOnly();

  const [items, setItems] = useState<OverviewMatrixSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 作成ダイアログ
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; purpose: string }>({
    name: '',
    purpose: '',
  });

  // 複製・削除の進行中フラグ
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await overviewMatrixApi.list(projectId);
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch overview matrices:', err);
      setError('俯瞰マトリクス一覧の読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const openCreate = () => {
    if (!canEdit) return;
    setDraft({ name: '', purpose: '' });
    setCreateError(null);
    setIsCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!draft.name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const snapshot = await overviewMatrixApi.create(projectId, {
        name: draft.name.trim(),
        purpose: draft.purpose.trim() || null,
      });
      router.push(
        `/dashboard/projects/${projectId}/overview-matrix/${snapshot.matrix.id}`,
      );
    } catch (err) {
      console.error('Failed to create overview matrix:', err);
      setCreateError('俯瞰マトリクスの作成に失敗しました');
      setCreating(false);
    }
  };

  // 複製: get → create(空ひな形) → replace(中身を上書き)。
  const handleDuplicate = async (item: OverviewMatrixSummary) => {
    if (!canEdit) return;
    setBusyId(item.id);
    try {
      const src = await overviewMatrixApi.get(item.id);
      const created = await overviewMatrixApi.create(projectId, {
        name: `${src.matrix.name}（コピー）`,
        purpose: src.matrix.purpose,
      });
      await overviewMatrixApi.replace(created.matrix.id, {
        name: `${src.matrix.name}（コピー）`,
        purpose: src.matrix.purpose,
        cellMode: src.matrix.cellMode,
        tagOptions: src.matrix.tagOptions,
        axes: src.axes.map((a) => ({
          axisIndex: a.axisIndex,
          name: a.name,
          side: a.side,
          items: a.items.map((it) => ({
            id: it.id,
            label: it.label,
            order: it.order,
            sourceType: it.sourceType,
            sourceId: it.sourceId,
          })),
        })),
        cells: src.cells.map((c) => ({
          rowItemId: c.rowItemId,
          colItemId: c.colItemId,
          layerItemId: c.layerItemId,
          value: c.value,
          note: c.note,
          isApplicable: c.isApplicable,
          reason: c.reason,
        })),
      });
      await fetchList();
    } catch (err) {
      console.error('Failed to duplicate overview matrix:', err);
      alert('複製に失敗しました');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (item: OverviewMatrixSummary) => {
    if (!canEdit) return;
    if (!confirm(`「${item.name}」を削除してもよろしいですか？軸・項目・セルもすべて削除されます。`))
      return;
    setBusyId(item.id);
    try {
      await overviewMatrixApi.remove(item.id);
      await fetchList();
    } catch (err) {
      console.error('Failed to delete overview matrix:', err);
      alert('削除に失敗しました');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="俯瞰思考"
        description="対象を2軸以上に分解して網羅マトリクスで抜け漏れを可視化"
        help="行・列（必要なら第3軸）に対象を並べ、交差セルを埋めて全体像を俯瞰します。非対称な組み合わせはグレーアウトで除外でき、未定セルから抜け漏れを発見できます。"
        backHref={`/dashboard/projects/${projectId}`}
        actions={
          canEdit ? (
            <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="h-4 w-4 mr-2" />
              新規作成
            </Button>
          ) : undefined
        }
      />

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-[300px]">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : items.length > 0 ? (
        <Card className="bg-white border-gray-200 overflow-hidden">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold text-gray-600">
                  <th className="px-4 py-2.5">名前</th>
                  <th className="px-4 py-2.5">目的</th>
                  <th className="px-4 py-2.5 text-center">モード</th>
                  <th className="px-4 py-2.5 text-center">軸数</th>
                  <th className="px-4 py-2.5">更新</th>
                  <th className="px-2 py-2.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() =>
                      router.push(
                        `/dashboard/projects/${projectId}/overview-matrix/${item.id}`,
                      )
                    }
                    className="group cursor-pointer border-b border-gray-100 last:border-0 hover:bg-blue-50/40"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/dashboard/projects/${projectId}/overview-matrix/${item.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-2 font-medium text-gray-900 hover:text-blue-600 hover:underline"
                      >
                        <TableProperties className="h-4 w-4 shrink-0 text-blue-500" />
                        {item.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 max-w-[280px] truncate">
                      {item.purpose || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs text-gray-600">
                      {CELL_MODE_LABEL[item.cellMode] ?? item.cellMode}
                    </td>
                    <td className="px-4 py-2.5 text-center text-gray-600">
                      {item.axisCount}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-400">
                      {item.updatedAt
                        ? new Date(item.updatedAt).toLocaleDateString('ja-JP')
                        : '—'}
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center justify-end gap-0.5">
                        {canEdit && (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDuplicate(item);
                              }}
                              disabled={busyId === item.id}
                              title="複製"
                              aria-label="複製"
                              className="rounded p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                            >
                              {busyId === item.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(item);
                              }}
                              disabled={busyId === item.id}
                              title="削除"
                              aria-label="削除"
                              className="rounded p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        <ChevronRight
                          className="h-4 w-4 text-gray-300 transition-colors group-hover:text-blue-500"
                          aria-hidden
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-white border-gray-200">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <TableProperties className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-gray-500 mb-2">俯瞰マトリクスがありません</p>
            <p className="text-sm text-gray-400 mb-4">
              対象を2軸以上に分解して、網羅マトリクスで抜け漏れを可視化しましょう
            </p>
            {canEdit && (
              <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700">
                <Plus className="h-4 w-4 mr-2" />
                新規作成
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* 作成ダイアログ */}
      <Dialog open={isCreateOpen} onOpenChange={(o) => !creating && setIsCreateOpen(o)}>
        <DialogContent className="bg-white border-gray-200 sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="text-gray-900 flex items-center gap-2">
              <TableProperties className="h-5 w-5 text-blue-600" />
              俯瞰マトリクスを作成
            </DialogTitle>
            <DialogDescription className="text-gray-500">
              名前と目的を入力してください。2軸の空マトリクスが作成され、編集画面が開きます。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-gray-700">名前</Label>
              <Input
                placeholder="例: 機能 × 利用者 の網羅"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && draft.name.trim()) handleCreate();
                }}
                className="bg-white border-gray-300"
                maxLength={200}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label className="text-gray-700">目的（任意）</Label>
              <Textarea
                placeholder="この俯瞰で何の抜け漏れを防ぎたいか"
                value={draft.purpose}
                onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
                className="bg-white border-gray-300"
              />
            </div>
            {createError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {createError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateOpen(false)}
              disabled={creating}
            >
              キャンセル
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!draft.name.trim() || creating}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  作成中...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  作成
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
