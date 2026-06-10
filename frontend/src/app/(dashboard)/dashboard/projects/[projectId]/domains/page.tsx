'use client';

/**
 * 領域（SubProject）管理ページ。
 *
 * 領域は ASIS/TOBE/課題で共有する分類軸。parentId==null を「領域」、
 * parentId を持つものを「サブ領域」として、親の下にインデント表示する
 * （業務定義シートの toTreeOrder と同様の親子並べ）。
 *
 * - 領域の作成（name）
 * - サブ領域の作成（name + 親領域 select）
 * - name のインライン編集（onBlur 保存）
 * - 削除
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, Plus, Trash2, FolderTree, CornerDownRight } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { subProjectApi, type SubProjectMaster } from '@/lib/masters';

/**
 * 親子（parentId 自己参照）でツリー化し、親→その子 の順に並べ替える。
 * ルートは parentId==null、または親が一覧に存在しないもの（孤児はルート扱い）。
 * 兄弟間は元の並び（order→createdAt 昇順）を保つ。循環は訪問済みセットで防ぐ。
 * 返り値は各行に depth（0=領域, 1=サブ領域）を付与する。
 */
function toTreeOrder(rows: SubProjectMaster[]): { row: SubProjectMaster; depth: number }[] {
  const byId = new Map<string, SubProjectMaster>(rows.map((r) => [r.id, r]));
  const childrenOf = new Map<string, SubProjectMaster[]>();
  const roots: SubProjectMaster[] = [];

  for (const r of rows) {
    const isRoot = r.parentId == null || !byId.has(r.parentId);
    if (isRoot) {
      roots.push(r);
    } else {
      const list = childrenOf.get(r.parentId!) ?? [];
      list.push(r);
      childrenOf.set(r.parentId!, list);
    }
  }

  const ordered: { row: SubProjectMaster; depth: number }[] = [];
  const visited = new Set<string>();
  const walk = (node: SubProjectMaster, depth: number) => {
    if (visited.has(node.id)) return; // 循環防止
    visited.add(node.id);
    ordered.push({ row: node, depth });
    for (const child of childrenOf.get(node.id) ?? []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  // 取りこぼし（循環の輪に含まれて未訪問のもの）は末尾に救済
  for (const r of rows) if (!visited.has(r.id)) ordered.push({ row: r, depth: 0 });

  return ordered;
}

export default function DomainsPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [items, setItems] = useState<SubProjectMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 領域 追加フォーム
  const [newDomainName, setNewDomainName] = useState('');
  // サブ領域 追加フォーム
  const [newSubName, setNewSubName] = useState('');
  const [newSubParentId, setNewSubParentId] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await subProjectApi.list(projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 領域（parentId==null）一覧。サブ領域の親 select に使う。
  const domains = items.filter((i) => i.parentId == null);

  const handleCreateDomain = useCallback(async () => {
    const name = newDomainName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      await subProjectApi.create(projectId, { name });
      setNewDomainName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setCreating(false);
    }
  }, [newDomainName, projectId, load]);

  const handleCreateSub = useCallback(async () => {
    const name = newSubName.trim();
    if (!name || !newSubParentId) return;
    setCreating(true);
    setError(null);
    try {
      await subProjectApi.create(projectId, { name, parentId: newSubParentId });
      setNewSubName('');
      // 親はそのまま残す（連続でサブ領域を追加しやすい）
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setCreating(false);
    }
  }, [newSubName, newSubParentId, projectId, load]);

  const treeRows = toTreeOrder(items);

  return (
    <div className="space-y-6">
      <PageHeader
        title="領域"
        description="領域は ASIS/TOBE/課題で共有する分類軸。領域の下にサブ領域を作れます。"
        help="領域は ASIS/TOBE/課題で共有する分類軸です。領域の下にサブ領域を作って入れ子に整理できます。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
        actions={
          <HowToPanel
            steps={[
              '「領域を追加」フォームに名前を入れて追加します（最上位の分類軸）。',
              '「サブ領域を追加」で名前を入れ、親領域を選んで追加します（領域の下に入れ子表示）。',
              '各行の名前をクリックして編集し、フォーカスを外すと保存されます。',
              'ゴミ箱アイコンで削除できます（サブ領域を持つ領域は先にサブ領域を削除してください）。',
            ]}
          />
        }
      />

      {/* 追加フォーム */}
      <Card className="p-4">
        <div className="space-y-3">
          {/* 領域の追加 */}
          <div className="flex items-center gap-2">
            <FolderTree className="h-4 w-4 shrink-0 text-indigo-600" />
            <input
              value={newDomainName}
              onChange={(e) => setNewDomainName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreateDomain();
              }}
              placeholder="領域名（例：受注・出荷）"
              className="flex-1 rounded border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <Button size="sm" onClick={() => void handleCreateDomain()} disabled={creating || !newDomainName.trim()}>
              {creating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
              領域を追加
            </Button>
          </div>

          {/* サブ領域の追加 */}
          <div className="flex items-center gap-2">
            <CornerDownRight className="h-4 w-4 shrink-0 text-gray-400" />
            <select
              value={newSubParentId}
              onChange={(e) => setNewSubParentId(e.target.value)}
              className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              title="親領域"
            >
              <option value="">親領域を選択…</option>
              {domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <input
              value={newSubName}
              onChange={(e) => setNewSubName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreateSub();
              }}
              placeholder="サブ領域名（例：与信確認）"
              className="flex-1 rounded border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleCreateSub()}
              disabled={creating || !newSubName.trim() || !newSubParentId}
            >
              {creating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
              サブ領域を追加
            </Button>
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      </Card>

      {/* 一覧（親子インデント） */}
      <Card className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">
            領域がありません。上のフォームから領域を追加してください。
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {treeRows.map(({ row, depth }) => (
              <DomainRow key={row.id} item={row} depth={depth} onChanged={load} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** 1 行（領域 or サブ領域）。名前のインライン編集（onBlur 保存）＋削除。 */
function DomainRow({
  item,
  depth,
  onChanged,
}: {
  item: SubProjectMaster;
  depth: number;
  onChanged: () => Promise<void> | void;
}) {
  const [name, setName] = useState(item.name);
  const [busy, setBusy] = useState(false);

  // 親側で再読込されると最新値に追従する
  useEffect(() => {
    setName(item.name);
  }, [item.name]);

  const handleSaveName = useCallback(async () => {
    const v = name.trim();
    if (!v || v === item.name) {
      setName(item.name); // 空 or 無変更は元に戻す
      return;
    }
    setBusy(true);
    try {
      await subProjectApi.update(item.id, { name: v });
      await onChanged();
    } catch {
      setName(item.name); // 失敗時は元に戻す
    } finally {
      setBusy(false);
    }
  }, [name, item.id, item.name, onChanged]);

  const handleDelete = useCallback(async () => {
    const label = depth === 0 ? '領域' : 'サブ領域';
    if (!confirm(`${label}「${item.name}」を削除しますか？`)) return;
    setBusy(true);
    try {
      await subProjectApi.delete(item.id);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }, [item.id, item.name, depth, onChanged]);

  const isSub = depth > 0;

  return (
    <li className="flex items-center gap-2 px-3 py-2" style={{ paddingLeft: `${12 + depth * 24}px` }}>
      {isSub ? (
        <CornerDownRight className="h-4 w-4 shrink-0 text-gray-400" />
      ) : (
        <FolderTree className="h-4 w-4 shrink-0 text-indigo-600" />
      )}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void handleSaveName()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setName(item.name);
            (e.target as HTMLInputElement).blur();
          }
        }}
        disabled={busy}
        className={`flex-1 rounded border border-transparent px-2 py-1 text-sm hover:border-gray-200 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50 ${
          isSub ? 'text-gray-700' : 'font-medium text-gray-800'
        }`}
      />
      {busy && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
      <button
        type="button"
        onClick={() => void handleDelete()}
        disabled={busy}
        className="text-gray-400 hover:text-red-600 disabled:opacity-40"
        title="削除"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}
