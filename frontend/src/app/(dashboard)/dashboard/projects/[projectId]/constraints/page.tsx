'use client';

/**
 * 制約条件 管理ページ。
 *
 * ASIS/TOBE 共通の制約条件（守るべき条件）と前提条件（成り立つと仮定する条件）を
 * kind（CONSTRAINT/ASSUMPTION）で区別して CRUD する。既存データ（kind 未設定）は制約扱い。
 * 各制約は領域（SubProject）に紐づけられる（任意）。
 * 一覧（kind フィルタタブ付き）+ 作成フォーム + 各行インライン編集（onBlur 保存）+ 削除。
 * 作法は InformationTypeRegistry / stakeholder-management の各ボードに合わせる。
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, Plus, Trash2, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  constraintApi,
  subProjectApi,
  normalizeConstraintKind,
  constraintKindMeta,
  CONSTRAINT_KINDS,
  type ConstraintKind,
  type ConstraintMaster,
  type SubProjectMaster,
} from '@/lib/masters';

// カテゴリ入力のプレースホルダ例（自由文字列なので候補を datalist で補助する）。
const CATEGORY_EXAMPLES = ['法令', '社内規定', '技術', '予算'];

export default function ConstraintsPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [constraints, setConstraints] = useState<ConstraintMaster[]>([]);
  const [subProjects, setSubProjects] = useState<SubProjectMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 作成フォーム（title + category + kind）。
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newKind, setNewKind] = useState<ConstraintKind>('CONSTRAINT');
  const [creating, setCreating] = useState(false);

  // kind フィルタ（既定は両方表示）。
  const [kindFilter, setKindFilter] = useState<'ALL' | ConstraintKind>('ALL');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [cs, sps] = await Promise.all([
        constraintApi.list(projectId),
        subProjectApi.list(projectId),
      ]);
      setConstraints(cs);
      setSubProjects(sps);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleCreate = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    setError(null);
    try {
      await constraintApi.create(projectId, {
        title,
        category: newCategory.trim() || null,
        kind: newKind,
      });
      setNewTitle('');
      setNewCategory('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '作成に失敗しました');
    } finally {
      setCreating(false);
    }
  }, [newTitle, newCategory, newKind, projectId, load]);

  // フィルタ適用後の一覧（既存データ＝kind 未設定は制約扱い）。
  const visibleConstraints =
    kindFilter === 'ALL'
      ? constraints
      : constraints.filter((c) => normalizeConstraintKind(c.kind) === kindFilter);

  return (
    <div className="space-y-6">
      <PageHeader
        title="制約条件・前提条件"
        description="ASIS/TOBE 共通の制約条件（守るべき条件）と前提条件（成り立つと仮定する条件）。領域に紐づけられます。"
        help="法令・社内規定・技術・予算など、設計や業務で必ず守るべき条件（制約）と、計画の前提として成り立つと仮定する条件（前提条件）を登録します。各行は領域（サブプロジェクト）に紐づけられます。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
        actions={
          <HowToPanel
            steps={[
              '上のフォームに種別（制約/前提条件）・タイトル・カテゴリ（任意）を入力して「追加」します。',
              '各行のタイトル・カテゴリ・説明はその場で編集でき、入力欄から離れると自動保存されます。',
              '「種別」バッジをクリックすると、制約 ⇔ 前提条件 を切り替えられます。',
              '上部のタブで「すべて／制約／前提条件」を切り替えて絞り込めます。',
              '「領域」を選ぶと、その行を特定の領域（サブプロジェクト）に紐づけられます。',
              '不要になった行はゴミ箱ボタンで削除します。',
            ]}
          />
        }
      />

      {/* 作成フォーム（kind + title + category） */}
      <Card className="bg-white border-gray-200">
        <CardContent className="flex flex-wrap items-end gap-2 p-4">
          <div className="w-32 space-y-1">
            <label className="block text-[11px] font-medium text-gray-500">種別</label>
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as ConstraintKind)}
              className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              aria-label="種別"
            >
              {CONSTRAINT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {constraintKindMeta[k].label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px] space-y-1">
            <label className="block text-[11px] font-medium text-gray-500">
              タイトル<span className="ml-1 text-rose-500">*</span>
            </label>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate();
              }}
              placeholder="制約条件（例：個人情報は社外に持ち出さない）"
              className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="w-44 space-y-1">
            <label className="block text-[11px] font-medium text-gray-500">
              カテゴリ
            </label>
            <input
              list="constraint-category-options"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate();
              }}
              placeholder="例：法令／社内規定／技術／予算"
              className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <Button
            size="sm"
            onClick={() => void handleCreate()}
            disabled={creating || !newTitle.trim()}
          >
            {creating ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
            追加
          </Button>
        </CardContent>
      </Card>

      {/* カテゴリ候補（自由文字列の補助） */}
      <datalist id="constraint-category-options">
        {CATEGORY_EXAMPLES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* kind フィルタタブ（既定は両方表示） */}
      <div className="flex items-center gap-1" role="tablist" aria-label="種別フィルタ">
        {(
          [
            { value: 'ALL', label: 'すべて' },
            { value: 'CONSTRAINT', label: constraintKindMeta.CONSTRAINT.label },
            { value: 'ASSUMPTION', label: constraintKindMeta.ASSUMPTION.label },
          ] as const
        ).map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={kindFilter === tab.value}
            onClick={() => setKindFilter(tab.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              kindFilter === tab.value
                ? 'bg-primary text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {tab.label}
            <span className="ml-1.5 text-xs opacity-70">
              {tab.value === 'ALL'
                ? constraints.length
                : constraints.filter((c) => normalizeConstraintKind(c.kind) === tab.value).length}
            </span>
          </button>
        ))}
      </div>

      {/* 一覧 */}
      {loading ? (
        <div className="flex h-[200px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <Card className="bg-white border-gray-200">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="w-10 px-2 py-2 text-left text-xs font-medium text-gray-400">
                      #
                    </th>
                    <th className="w-28 px-3 py-2 text-left text-xs font-semibold text-gray-600">
                      種別
                    </th>
                    <th className="min-w-[200px] px-3 py-2 text-left text-xs font-semibold text-gray-600">
                      タイトル
                    </th>
                    <th className="w-40 px-3 py-2 text-left text-xs font-semibold text-gray-600">
                      カテゴリ
                    </th>
                    <th className="min-w-[200px] px-3 py-2 text-left text-xs font-semibold text-gray-600">
                      説明
                    </th>
                    <th className="w-44 px-3 py-2 text-left text-xs font-semibold text-gray-600">
                      領域
                    </th>
                    <th className="w-12 px-2 py-2" aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {visibleConstraints.map((c, i) => (
                    <ConstraintRow
                      key={c.id}
                      index={i + 1}
                      constraint={c}
                      subProjects={subProjects}
                      onChanged={load}
                      onError={setError}
                    />
                  ))}
                  {visibleConstraints.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-10 text-center text-sm text-gray-400"
                      >
                        {constraints.length === 0
                          ? 'まだ制約条件・前提条件がありません。上のフォームから追加してください。'
                          : 'この種別の行はありません。'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1行（インライン編集 + onBlur 保存 + 削除）
// ---------------------------------------------------------------------------

function ConstraintRow({
  index,
  constraint,
  subProjects,
  onChanged,
  onError,
}: {
  index: number;
  constraint: ConstraintMaster;
  subProjects: SubProjectMaster[];
  onChanged: () => Promise<void> | void;
  onError: (msg: string | null) => void;
}) {
  // 表示はローカルドラフトで持ち、onBlur で差分があるときだけ PATCH する。
  const [title, setTitle] = useState(constraint.title);
  const [category, setCategory] = useState(constraint.category ?? '');
  const [description, setDescription] = useState(constraint.description ?? '');
  const [busy, setBusy] = useState(false);

  // 親で再読込された値に追従する（並び替え・他クライアント編集など）。
  useEffect(() => {
    setTitle(constraint.title);
    setCategory(constraint.category ?? '');
    setDescription(constraint.description ?? '');
  }, [constraint.title, constraint.category, constraint.description]);

  // 文字列フィールドの onBlur 保存（title は空なら元値に戻す）。
  const saveText = useCallback(
    async (
      key: 'title' | 'category' | 'description',
      raw: string,
    ) => {
      const value = raw.trim();
      if (key === 'title') {
        if (!value || value === constraint.title) {
          setTitle(constraint.title);
          return;
        }
      } else {
        const current = (key === 'category' ? constraint.category : constraint.description) ?? '';
        if (value === current) return;
      }
      setBusy(true);
      onError(null);
      try {
        await constraintApi.update(constraint.id, {
          [key]: key === 'title' ? value : value === '' ? null : value,
        });
        await onChanged();
      } catch (e) {
        onError(e instanceof Error ? e.message : '保存に失敗しました');
      } finally {
        setBusy(false);
      }
    },
    [constraint.id, constraint.title, constraint.category, constraint.description, onChanged, onError],
  );

  // 種別（kind）トグル：クリックで 制約 ⇔ 前提条件 を切り替えて即保存。
  const kind = normalizeConstraintKind(constraint.kind);
  const toggleKind = useCallback(async () => {
    const next: ConstraintKind = kind === 'CONSTRAINT' ? 'ASSUMPTION' : 'CONSTRAINT';
    setBusy(true);
    onError(null);
    try {
      await constraintApi.update(constraint.id, { kind: next });
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setBusy(false);
    }
  }, [constraint.id, kind, onChanged, onError]);

  // 領域（subProjectId）select は変更即保存。
  const saveSubProject = useCallback(
    async (value: string) => {
      const next = value === '' ? null : value;
      if (next === constraint.subProjectId) return;
      setBusy(true);
      onError(null);
      try {
        await constraintApi.update(constraint.id, { subProjectId: next });
        await onChanged();
      } catch (e) {
        onError(e instanceof Error ? e.message : '保存に失敗しました');
      } finally {
        setBusy(false);
      }
    },
    [constraint.id, constraint.subProjectId, onChanged, onError],
  );

  const handleDelete = useCallback(async () => {
    if (!confirm(`制約条件「${constraint.title}」を削除しますか？`)) return;
    setBusy(true);
    onError(null);
    try {
      await constraintApi.delete(constraint.id);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : '削除に失敗しました');
    } finally {
      setBusy(false);
    }
  }, [constraint.id, constraint.title, onChanged, onError]);

  return (
    <tr className="border-b border-gray-100 align-top hover:bg-blue-50/30">
      <td className="px-2 py-2 text-xs text-gray-400">
        <span className="inline-flex items-center gap-1">
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
          ) : (
            <ShieldCheck className="h-3 w-3 text-gray-300" />
          )}
          {index}
        </span>
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={() => void toggleKind()}
          disabled={busy}
          title="クリックで 制約 ⇔ 前提条件 を切り替え"
          aria-label={`種別を切り替え（現在：${constraintKindMeta[kind].label}）`}
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-opacity hover:opacity-75 disabled:opacity-40 ${constraintKindMeta[kind].badge}`}
        >
          {constraintKindMeta[kind].label}
        </button>
      </td>
      <td className="px-3 py-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={(e) => void saveText('title', e.target.value)}
          placeholder="タイトル"
          className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-[#050f3e] hover:border-gray-200 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </td>
      <td className="px-3 py-2">
        <input
          list="constraint-category-options"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          onBlur={(e) => void saveText('category', e.target.value)}
          placeholder="例：法令／社内規定／技術／予算"
          className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-gray-800 hover:border-gray-200 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </td>
      <td className="px-3 py-2">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={(e) => void saveText('description', e.target.value)}
          rows={1}
          placeholder="補足・根拠など"
          className="w-full resize-y rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-gray-800 hover:border-gray-200 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </td>
      <td className="px-3 py-2">
        <select
          value={constraint.subProjectId ?? ''}
          onChange={(e) => void saveSubProject(e.target.value)}
          className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          aria-label="領域"
        >
          <option value="">（領域なし）</option>
          {subProjects.map((sp) => (
            <option key={sp.id} value={sp.id}>
              {sp.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2 text-center">
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={busy}
          className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
          title="この制約条件を削除"
          aria-label="この制約条件を削除"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}
