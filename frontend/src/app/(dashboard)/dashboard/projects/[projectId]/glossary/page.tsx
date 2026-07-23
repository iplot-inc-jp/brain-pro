'use client';

/**
 * 用語集・用語対応表 管理ページ。
 *
 * 1つの用語について「意味（definition）」「正（sourceOfTruth）」「名前の対応（mappings）」の
 * 3点セットを管理する。名前の対応だけでは、値が食い違ったときにどちらを信じるかが
 * 決まらないため、正（source of truth）を必ず併せて持たせる設計にしている。
 *
 * 一覧（カテゴリフィルタ + 検索 + ヘッダークリックソート）+ 作成フォーム +
 * 各行インライン編集（onBlur 保存）+ 用語対応の追加/編集/削除。
 * 作法は constraints / stakeholder-management の各ボードに合わせる。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, Plus, Trash2, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EditGate } from '@/components/edit-gate';
import { useReadOnly } from '@/components/read-only-context';
import { SortableTh } from '@/components/ui/sortable-th';
import { useTableSort } from '@/lib/use-table-sort';
import {
  glossaryTermApi,
  GLOSSARY_MAPPING_CONTEXTS,
  GLOSSARY_TERM_STATUSES,
  glossaryMappingContextMeta,
  glossaryTermStatusMeta,
  normalizeGlossaryContext,
  normalizeGlossaryStatus,
  type GlossaryMappingContext,
  type GlossaryTermMaster,
  type GlossaryTermStatus,
} from '@/lib/masters';

// カテゴリ入力のプレースホルダ例（自由文字列なので候補を datalist で補助する）。
const CATEGORY_EXAMPLES = ['取引先', '商品', '在庫', '受注・出荷', '仕入', '金額'];

// 「正」入力の候補例（自由文字列。どのシステムを信じるかを書く）。
const SOURCE_OF_TRUTH_EXAMPLES = [
  '基幹システム',
  '倉庫管理システム（WMS）',
  '会計システム',
  '取引先（EDI電文）',
  '仕入先',
  '計算値（保持しない）',
];

export default function GlossaryPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const { canEdit } = useReadOnly();

  const [terms, setTerms] = useState<GlossaryTermMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 作成フォーム。
  const [newTermCode, setNewTermCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newSourceOfTruth, setNewSourceOfTruth] = useState('');
  const [creating, setCreating] = useState(false);

  // 絞り込み。
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [keyword, setKeyword] = useState('');

  // 展開中の用語（用語対応の編集領域）。
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setError(null);
    try {
      setTerms(await glossaryTermApi.list(projectId));
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
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      await glossaryTermApi.create(projectId, {
        termCode: newTermCode.trim() || null,
        name,
        category: newCategory.trim() || null,
        sourceOfTruth: newSourceOfTruth.trim() || null,
      });
      setNewTermCode('');
      setNewName('');
      setNewSourceOfTruth('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '作成に失敗しました');
    } finally {
      setCreating(false);
    }
  }, [newTermCode, newName, newCategory, newSourceOfTruth, projectId, load]);

  const patchTerm = useCallback(
    async (id: string, patch: Parameters<typeof glossaryTermApi.update>[1]) => {
      setError(null);
      try {
        await glossaryTermApi.update(id, patch);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : '更新に失敗しました');
      }
    },
    [load],
  );

  const handleDelete = useCallback(
    async (term: GlossaryTermMaster) => {
      if (!window.confirm(`用語「${term.name}」を削除します。用語対応も一緒に削除されます。`)) return;
      setError(null);
      try {
        await glossaryTermApi.delete(term.id);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : '削除に失敗しました');
      }
    },
    [load],
  );

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // カテゴリ一覧（フィルタタブ用）。
  const categories = useMemo(() => {
    const set = new Set<string>();
    terms.forEach((t) => {
      if (t.category) set.add(t.category);
    });
    return Array.from(set).sort();
  }, [terms]);

  // フィルタ適用後の一覧（カテゴリ + キーワード）。
  // キーワードは用語名・意味・正・用語対応の値すべてを横断して探す
  // （「客先」で検索して「得意先」に辿り着けるようにするため）。
  const visibleTerms = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return terms.filter((t) => {
      if (categoryFilter !== 'ALL' && (t.category ?? '') !== categoryFilter) return false;
      if (!kw) return true;
      const haystack = [
        t.termCode,
        t.name,
        t.definition,
        t.sourceOfTruth,
        t.sourceOfTruthNote,
        t.category,
        t.notes,
        ...t.mappings.map((m) => `${m.systemName ?? ''} ${m.value} ${m.note ?? ''}`),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(kw);
    });
  }, [terms, categoryFilter, keyword]);

  const sortAccessors = useMemo(
    () => ({
      termCode: (t: GlossaryTermMaster) => t.termCode ?? '',
      name: (t: GlossaryTermMaster) => t.name,
      category: (t: GlossaryTermMaster) => t.category ?? '',
      definition: (t: GlossaryTermMaster) => t.definition ?? '',
      sourceOfTruth: (t: GlossaryTermMaster) => t.sourceOfTruth ?? '',
      status: (t: GlossaryTermMaster) => glossaryTermStatusMeta[normalizeGlossaryStatus(t.status)].label,
    }),
    [],
  );
  const { sorted: sortedTerms, sortKey, sortDir, toggleSort } = useTableSort(
    visibleTerms,
    sortAccessors,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="用語集・用語対応表"
        description="1つの概念について「意味」「正（どこを信じるか）」「名前の対応（現場・DB・画面・電文）」をまとめて管理します。"
        help="同じものが場所によって違う名前で呼ばれ、しかも値が食い違うことがあります。用語ごとに、意味（それは何か）・正（値が食い違ったときにどこを信じるか）・名前の対応（現場の言い方 / DBカラム / 画面項目 / 電文フィールド）を登録してください。生成AIに読ませると、命名の揺れと値の取り違えを防げます。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
        actions={
          <HowToPanel
            steps={[
              '上のフォームに「正式用語」を入力して「追加」します。概念コード（CPT-001 など）・カテゴリ・正は任意です。',
              '各行の項目はその場で編集でき、入力欄から離れると自動保存されます。',
              '行頭の「▶」を押すと用語対応（名前の対応）を編集できます。現場の言い方・DBカラム・画面項目・電文フィールドなどを追加してください。',
              '「正」には値が食い違ったときにどこを信じるかを書きます（例：在庫数の正は倉庫管理システム）。ここが最も見落とされます。',
              '文脈「使用禁止」に、使ってはいけない言い方（例：顧客）を登録できます。',
              '検索欄は用語名だけでなく用語対応の値も横断して探します。「客先」で検索して「得意先」に辿り着けます。',
            ]}
          />
        }
      />

      {/* 作成フォーム */}
      <EditGate>
        <Card className="bg-white border-gray-200">
          <CardContent className="flex flex-wrap items-end gap-2 p-4">
            <div className="w-28 space-y-1">
              <label className="block text-[11px] font-medium text-gray-500">概念コード</label>
              <input
                value={newTermCode}
                onChange={(e) => setNewTermCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreate();
                }}
                placeholder="CPT-001"
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex-1 min-w-[180px] space-y-1">
              <label className="block text-[11px] font-medium text-gray-500">
                正式用語<span className="ml-1 text-rose-500">*</span>
              </label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreate();
                }}
                placeholder="例：得意先"
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="w-40 space-y-1">
              <label className="block text-[11px] font-medium text-gray-500">カテゴリ</label>
              <input
                list="glossary-category-options"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreate();
                }}
                placeholder="例：取引先"
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="w-56 space-y-1">
              <label className="block text-[11px] font-medium text-gray-500">正（どこを信じるか）</label>
              <input
                list="glossary-sot-options"
                value={newSourceOfTruth}
                onChange={(e) => setNewSourceOfTruth(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreate();
                }}
                placeholder="例：基幹システム"
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <Button size="sm" onClick={() => void handleCreate()} disabled={creating || !newName.trim()}>
              {creating ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-1 h-4 w-4" />
              )}
              追加
            </Button>
          </CardContent>
        </Card>
      </EditGate>

      <datalist id="glossary-category-options">
        {CATEGORY_EXAMPLES.concat(
          categories.filter((c) => !CATEGORY_EXAMPLES.includes(c)),
        ).map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="glossary-sot-options">
        {SOURCE_OF_TRUTH_EXAMPLES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* 絞り込み */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="用語・意味・別名・カラム名を横断検索（例：客先）"
            className="w-80 rounded-md border border-gray-300 py-1.5 pl-8 pr-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex items-center gap-1" role="tablist" aria-label="カテゴリフィルタ">
          {['ALL', ...categories].map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={categoryFilter === c}
              onClick={() => setCategoryFilter(c)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                categoryFilter === c
                  ? 'bg-primary text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {c === 'ALL' ? 'すべて' : c}
              <span className="ml-1.5 text-xs opacity-70">
                {c === 'ALL' ? terms.length : terms.filter((t) => (t.category ?? '') === c).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 一覧 */}
      {loading ? (
        <div className="flex h-[200px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <EditGate dim={false}>
          <Card className="bg-white border-gray-200">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="w-8 px-2 py-2" aria-label="展開" />
                      <SortableTh
                        label="コード"
                        sortKey="termCode"
                        current={sortKey}
                        dir={sortDir}
                        onToggle={toggleSort}
                        className="w-24 text-left text-xs font-semibold text-gray-600"
                      />
                      <SortableTh
                        label="正式用語"
                        sortKey="name"
                        current={sortKey}
                        dir={sortDir}
                        onToggle={toggleSort}
                        className="w-40 text-left text-xs font-semibold text-gray-600"
                      />
                      <SortableTh
                        label="意味"
                        sortKey="definition"
                        current={sortKey}
                        dir={sortDir}
                        onToggle={toggleSort}
                        className="min-w-[240px] text-left text-xs font-semibold text-gray-600"
                      />
                      <SortableTh
                        label="正（どこを信じるか）"
                        sortKey="sourceOfTruth"
                        current={sortKey}
                        dir={sortDir}
                        onToggle={toggleSort}
                        className="w-48 text-left text-xs font-semibold text-gray-600"
                      />
                      <SortableTh
                        label="カテゴリ"
                        sortKey="category"
                        current={sortKey}
                        dir={sortDir}
                        onToggle={toggleSort}
                        className="w-32 text-left text-xs font-semibold text-gray-600"
                      />
                      <SortableTh
                        label="状態"
                        sortKey="status"
                        current={sortKey}
                        dir={sortDir}
                        onToggle={toggleSort}
                        className="w-24 text-left text-xs font-semibold text-gray-600"
                      />
                      <th className="w-24 px-2 py-2 text-left text-xs font-semibold text-gray-600">対応</th>
                      <th className="w-12 px-2 py-2" aria-label="操作" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTerms.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-sm text-gray-400">
                          {terms.length === 0
                            ? '用語がまだ登録されていません。上のフォームから追加してください。'
                            : '条件に一致する用語がありません。'}
                        </td>
                      </tr>
                    ) : (
                      sortedTerms.map((term) => {
                        const status = normalizeGlossaryStatus(term.status);
                        const isOpen = expanded.has(term.id);
                        return (
                          <TermRow
                            key={term.id}
                            term={term}
                            status={status}
                            isOpen={isOpen}
                            canEdit={canEdit}
                            onToggle={() => toggleExpand(term.id)}
                            onPatch={patchTerm}
                            onDelete={() => void handleDelete(term)}
                            onReload={load}
                            onError={setError}
                          />
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </EditGate>
      )}
    </div>
  );
}

/** 用語1行（インライン編集 + 用語対応の展開）。 */
function TermRow({
  term,
  status,
  isOpen,
  canEdit,
  onToggle,
  onPatch,
  onDelete,
  onReload,
  onError,
}: {
  term: GlossaryTermMaster;
  status: GlossaryTermStatus;
  isOpen: boolean;
  canEdit: boolean;
  onToggle: () => void;
  onPatch: (id: string, patch: Parameters<typeof glossaryTermApi.update>[1]) => Promise<void>;
  onDelete: () => void;
  onReload: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const inputCls =
    'w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-gray-200 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-default';

  return (
    <>
      <tr className="border-b border-gray-100 align-top hover:bg-gray-50/60">
        <td className="px-2 py-2">
          <button
            type="button"
            onClick={onToggle}
            aria-label={isOpen ? '用語対応を閉じる' : '用語対応を開く'}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="px-2 py-2">
          <input
            defaultValue={term.termCode ?? ''}
            disabled={!canEdit}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (term.termCode ?? '')) void onPatch(term.id, { termCode: v || null });
            }}
            placeholder="CPT-001"
            className={`${inputCls} font-mono text-xs`}
          />
        </td>
        <td className="px-2 py-2">
          <input
            defaultValue={term.name}
            disabled={!canEdit}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== term.name) void onPatch(term.id, { name: v });
            }}
            className={`${inputCls} font-medium`}
          />
        </td>
        <td className="px-2 py-2">
          <textarea
            defaultValue={term.definition ?? ''}
            disabled={!canEdit}
            rows={2}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (term.definition ?? '')) void onPatch(term.id, { definition: v || null });
            }}
            placeholder="それは何か（例：商品を販売する相手。請求・与信・単価の単位）"
            className={`${inputCls} resize-y`}
          />
        </td>
        <td className="px-2 py-2">
          <input
            list="glossary-sot-options"
            defaultValue={term.sourceOfTruth ?? ''}
            disabled={!canEdit}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (term.sourceOfTruth ?? '')) void onPatch(term.id, { sourceOfTruth: v || null });
            }}
            placeholder="例：倉庫管理システム"
            className={inputCls}
          />
          <input
            defaultValue={term.sourceOfTruthNote ?? ''}
            disabled={!canEdit}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (term.sourceOfTruthNote ?? ''))
                void onPatch(term.id, { sourceOfTruthNote: v || null });
            }}
            placeholder="補足（更新経路・更新できる人）"
            className={`${inputCls} text-xs text-gray-500`}
          />
        </td>
        <td className="px-2 py-2">
          <input
            list="glossary-category-options"
            defaultValue={term.category ?? ''}
            disabled={!canEdit}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (term.category ?? '')) void onPatch(term.id, { category: v || null });
            }}
            className={inputCls}
          />
        </td>
        <td className="px-2 py-2">
          <select
            value={status}
            disabled={!canEdit}
            onChange={(e) => void onPatch(term.id, { status: e.target.value as GlossaryTermStatus })}
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${glossaryTermStatusMeta[status].badge}`}
          >
            {GLOSSARY_TERM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {glossaryTermStatusMeta[s].label}
              </option>
            ))}
          </select>
        </td>
        <td className="px-2 py-2">
          <button
            type="button"
            onClick={onToggle}
            className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-200"
          >
            {term.mappings.length} 件
          </button>
        </td>
        <td className="px-2 py-2">
          {canEdit && (
            <button
              type="button"
              onClick={onDelete}
              aria-label="削除"
              className="rounded p-1 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </td>
      </tr>

      {isOpen && (
        <tr className="border-b border-gray-100 bg-gray-50/60">
          <td />
          <td colSpan={8} className="px-2 pb-4 pt-1">
            <MappingEditor
              term={term}
              canEdit={canEdit}
              onReload={onReload}
              onError={onError}
            />
            <div className="mt-3">
              <label className="block text-[11px] font-medium text-gray-500">
                備考（紛らわしい別概念との違いなど）
              </label>
              <textarea
                defaultValue={term.notes ?? ''}
                disabled={!canEdit}
                rows={2}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (term.notes ?? '')) void onPatch(term.id, { notes: v || null });
                }}
                placeholder="例：「納品先」とは別概念。得意先は請求先、納品先は届け先。"
                className="mt-1 w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** 用語対応（名前の対応）の編集領域。 */
function MappingEditor({
  term,
  canEdit,
  onReload,
  onError,
}: {
  term: GlossaryTermMaster;
  canEdit: boolean;
  onReload: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [newContext, setNewContext] = useState<GlossaryMappingContext>('ALIAS');
  const [newSystemName, setNewSystemName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [adding, setAdding] = useState(false);

  const handleAdd = useCallback(async () => {
    const value = newValue.trim();
    if (!value) return;
    setAdding(true);
    onError(null);
    try {
      await glossaryTermApi.addMapping(term.id, {
        context: newContext,
        systemName: newSystemName.trim() || null,
        value,
        order: term.mappings.length,
      });
      setNewValue('');
      setNewSystemName('');
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : '用語対応の追加に失敗しました');
    } finally {
      setAdding(false);
    }
  }, [newContext, newSystemName, newValue, term.id, term.mappings.length, onReload, onError]);

  const handleDelete = useCallback(
    async (id: string) => {
      onError(null);
      try {
        await glossaryTermApi.deleteMapping(id);
        await onReload();
      } catch (e) {
        onError(e instanceof Error ? e.message : '用語対応の削除に失敗しました');
      }
    },
    [onReload, onError],
  );

  const patchMapping = useCallback(
    async (id: string, patch: Parameters<typeof glossaryTermApi.updateMapping>[1]) => {
      onError(null);
      try {
        await glossaryTermApi.updateMapping(id, patch);
        await onReload();
      } catch (e) {
        onError(e instanceof Error ? e.message : '用語対応の更新に失敗しました');
      }
    },
    [onReload, onError],
  );

  const cellCls =
    'w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-gray-200 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary';

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-2 text-xs font-semibold text-gray-600">
        用語対応 — この概念が、どこで何と呼ばれているか
      </div>

      {term.mappings.length === 0 ? (
        <div className="px-1 py-2 text-xs text-gray-400">
          まだ登録がありません。現場の言い方・DBカラム・画面項目・電文フィールドを追加してください。
        </div>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="w-32 px-1 py-1 text-left text-[11px] font-medium text-gray-500">文脈</th>
              <th className="w-40 px-1 py-1 text-left text-[11px] font-medium text-gray-500">
                システム・電文
              </th>
              <th className="px-1 py-1 text-left text-[11px] font-medium text-gray-500">名前</th>
              <th className="w-56 px-1 py-1 text-left text-[11px] font-medium text-gray-500">補足</th>
              <th className="w-10 px-1 py-1" aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {term.mappings.map((m) => {
              const ctx = normalizeGlossaryContext(m.context);
              return (
                <tr key={m.id} className="border-b border-gray-50">
                  <td className="px-1 py-1">
                    <select
                      value={ctx}
                      disabled={!canEdit}
                      onChange={(e) =>
                        void patchMapping(m.id, { context: e.target.value as GlossaryMappingContext })
                      }
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${glossaryMappingContextMeta[ctx].badge}`}
                    >
                      {GLOSSARY_MAPPING_CONTEXTS.map((c) => (
                        <option key={c} value={c}>
                          {glossaryMappingContextMeta[c].label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <input
                      defaultValue={m.systemName ?? ''}
                      disabled={!canEdit}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (m.systemName ?? '')) void patchMapping(m.id, { systemName: v || null });
                      }}
                      placeholder="例：基幹DB / WMS電文"
                      className={`${cellCls} text-xs`}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      defaultValue={m.value}
                      disabled={!canEdit}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== m.value) void patchMapping(m.id, { value: v });
                      }}
                      className={`${cellCls} font-mono`}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      defaultValue={m.note ?? ''}
                      disabled={!canEdit}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (m.note ?? '')) void patchMapping(m.id, { note: v || null });
                      }}
                      className={`${cellCls} text-xs text-gray-500`}
                    />
                  </td>
                  <td className="px-1 py-1">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(m.id)}
                        aria-label="用語対応を削除"
                        className="rounded p-1 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {canEdit && (
        <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-2">
          <div className="w-36 space-y-1">
            <label className="block text-[11px] font-medium text-gray-500">文脈</label>
            <select
              value={newContext}
              onChange={(e) => setNewContext(e.target.value as GlossaryMappingContext)}
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {GLOSSARY_MAPPING_CONTEXTS.map((c) => (
                <option key={c} value={c}>
                  {glossaryMappingContextMeta[c].label}
                </option>
              ))}
            </select>
          </div>
          <div className="w-40 space-y-1">
            <label className="block text-[11px] font-medium text-gray-500">システム・電文</label>
            <input
              value={newSystemName}
              onChange={(e) => setNewSystemName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAdd();
              }}
              placeholder="任意"
              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex-1 min-w-[180px] space-y-1">
            <label className="block text-[11px] font-medium text-gray-500">
              名前<span className="ml-1 text-rose-500">*</span>
            </label>
            <input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAdd();
              }}
              placeholder={glossaryMappingContextMeta[newContext].hint || '例：customer.customer_cd'}
              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <Button size="sm" variant="outline" onClick={() => void handleAdd()} disabled={adding || !newValue.trim()}>
            {adding ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
            対応を追加
          </Button>
        </div>
      )}
    </div>
  );
}
