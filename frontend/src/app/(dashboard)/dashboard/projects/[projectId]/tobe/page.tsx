'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  GitBranch,
  Plus,
  Loader2,
  FolderTree,
  Folder,
  Layers,
  ChevronRight,
  Target,
  Sparkles,
  Network,
  Milestone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { EditableMemoBoard } from '@/components/records/editable-memo-board';
import {
  tobeVisionApi,
  tobeRoadmapApi,
  type TobeVision,
  type TobeVisionInput,
  type TobeRoadmap,
  type TobeRoadmapInput,
} from '@/lib/asis-tobe';
// 領域（SubProject）は ASIS と共通の SubProject マスタから取得する（@/lib/masters に統一）。
import { subProjectApi, type SubProjectMaster } from '@/lib/masters';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

type FlowKind = 'ASIS' | 'TOBE';

type BusinessFlow = {
  id: string;
  name: string;
  kind: FlowKind;
  folderId?: string | null;
  subProjectId?: string | null;
  description?: string | null;
};

// 領域（SubProject）は ASIS と共通の SubProject マスタ。parentId で 領域→サブ領域 の入れ子を持つ。
type SubProject = SubProjectMaster;
type FlowFolder = { id: string; name: string };

// 「未分類」セレクト用のセンチネル（空文字を value にすると未選択と区別しにくいため）。
const UNASSIGNED = '__none__';

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/**
 * 領域(parentId==null)→サブ領域(parentId 有り) の入れ子を DFS 順（親→その子…）に並べ替え、
 * depth 付きのフラット配列にする。孤児（親が一覧に存在しない）はトップ領域扱い。
 */
function flattenSubProjects(
  list: SubProject[]
): { sub: SubProject; depth: number }[] {
  const byId = new Map(list.map((s) => [s.id, s]));
  const childrenOf = new Map<string | null, SubProject[]>();
  for (const s of list) {
    const key = s.parentId && byId.has(s.parentId) ? s.parentId : null;
    const arr = childrenOf.get(key) ?? [];
    arr.push(s);
    childrenOf.set(key, arr);
  }
  const out: { sub: SubProject; depth: number }[] = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    const children = (childrenOf.get(parentId) ?? []).sort(
      (a, b) => a.order - b.order || a.name.localeCompare(b.name)
    );
    for (const sub of children) {
      if (visited.has(sub.id)) continue; // 循環(parentId ループ)で無限再帰しないよう防止
      visited.add(sub.id);
      out.push({ sub, depth });
      walk(sub.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export default function TobeManagementPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;

  const [flows, setFlows] = useState<BusinessFlow[]>([]);
  const [subProjects, setSubProjects] = useState<SubProject[]>([]);
  const [folders, setFolders] = useState<FlowFolder[]>([]);
  // 段階設計の「打ち手」セレクト用。あるべき姿・打ち手（TobeVision）を ID→ラベルで参照する。
  const [tobeVisions, setTobeVisions] = useState<TobeVision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // フロー作成ダイアログ
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  // 領域／サブ領域（SubProject）。UNASSIGNED は未分類。
  const [newSubProjectId, setNewSubProjectId] = useState(UNASSIGNED);
  const [creating, setCreating] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 領域（SubProject）は ASIS と共通の subProjectApi.list で取得する。
      // あるべき姿・打ち手（TobeVision）は段階設計の「打ち手」セレクトの選択肢に使う。
      const [flowRes, subProjectsData, folderRes, tobeVisionsData] =
        await Promise.all([
          fetch(`${API_URL}/api/business-flows/project/${projectId}/all`, {
            headers: authHeaders(),
          }),
          subProjectApi.list(projectId).catch(() => [] as SubProject[]),
          fetch(`${API_URL}/api/projects/${projectId}/flow-folders`, {
            headers: authHeaders(),
          }),
          tobeVisionApi.list(projectId).catch(() => [] as TobeVision[]),
        ]);

      if (flowRes.ok) {
        const data = await flowRes.json();
        setFlows(Array.isArray(data) ? data : []);
      } else {
        setError('業務フローの読み込みに失敗しました');
      }
      setSubProjects(Array.isArray(subProjectsData) ? subProjectsData : []);
      setTobeVisions(Array.isArray(tobeVisionsData) ? tobeVisionsData : []);
      if (folderRes.ok) {
        const data = await folderRes.json();
        setFolders(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch TOBE data:', err);
      setError('読み込み中にエラーが発生しました');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const tobeFlows = useMemo(
    () => flows.filter((f) => f.kind === 'TOBE'),
    [flows]
  );

  // 領域→サブ領域 を入れ子（DFS）で並べたセレクタ用の一覧。
  const flatSubProjects = useMemo(
    () => flattenSubProjects(subProjects),
    [subProjects]
  );

  const subProjectName = useCallback(
    (id?: string | null) => subProjects.find((s) => s.id === id)?.name ?? null,
    [subProjects]
  );
  const folderName = useCallback(
    (id?: string | null) => folders.find((f) => f.id === id)?.name ?? null,
    [folders]
  );

  // メモボードの select 列用：領域／サブ領域（全角スペースで入れ子インデント）。
  const subProjectOptions = useMemo(
    () =>
      flatSubProjects.map(({ sub, depth }) => ({
        value: sub.id,
        label: `${'　'.repeat(depth)}${sub.name}`,
      })),
    [flatSubProjects]
  );

  // 段階設計の「打ち手」select 用：あるべき姿・打ち手（TobeVision）を ID→ラベルで。
  // ラベルは「打ち手」優先、無ければ「あるべき姿」、どちらも無ければ領域名で代替する。
  const tobeVisionOptions = useMemo(
    () =>
      tobeVisions.map((v) => {
        const label =
          v.countermeasure?.trim() ||
          v.vision?.trim() ||
          subProjectName(v.subProjectId) ||
          v.area?.trim() ||
          '（無題の打ち手）';
        return { value: v.id, label };
      }),
    [tobeVisions, subProjectName]
  );

  const openFlow = (id: string) =>
    router.push(`/dashboard/projects/${projectId}/flows/${id}`);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/business-flows`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          projectId,
          name: newName.trim(),
          kind: 'TOBE',
          description: newDescription.trim() || undefined,
          // ASIS と共通の SubProject マスタから選んだ領域／サブ領域。未分類なら null。
          subProjectId: newSubProjectId === UNASSIGNED ? null : newSubProjectId,
        }),
      });
      if (res.ok) {
        const created: BusinessFlow = await res.json();
        setIsCreateOpen(false);
        setNewName('');
        setNewDescription('');
        setNewSubProjectId(UNASSIGNED);
        if (created?.id) {
          openFlow(created.id);
          return;
        }
        fetchAll();
      } else {
        setError('TOBEフローの作成に失敗しました');
      }
    } catch (err) {
      console.error('Failed to create TOBE flow:', err);
      setError('作成中にエラーが発生しました');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Target className="h-6 w-6 text-emerald-600" />
            TOBE管理
          </span>
        }
        description="あるべき姿（TOBE）の業務フロー・打ち手・段階設計を管理"
        help="このページであるべき姿（TOBE）の業務フローを選んで開き、打ち手・段階設計（3ヶ月/1年/3年）を一箇所で管理します。"
        actions={
          <HowToPanel
            title="TOBE管理の使い方"
            steps={[
              'TOBE業務フローのカードをクリックすると、そのフローを開いて編集できます。',
              '「あるべき姿を追加」で領域（ASISと共通）を選んで新しいあるべき姿フローを作成し、そのまま編集画面に移動します。',
              'あるべき姿・打ち手の表に、領域ごとのあるべき姿と打ち手・期待効果を書き留めます。',
              '段階設計の表で、打ち手を 3ヶ月/1年/3年 に割り当て、ROI・コスト・回収期間・スコープ判断を整理します。',
            ]}
          />
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-[320px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : (
        <>
          {/* ── Section: TOBE業務フロー ───────────────────────── */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
                  <GitBranch className="h-5 w-5 text-emerald-600" />
                  TOBE業務フロー
                  <span className="text-sm font-normal text-muted-foreground">
                    （{tobeFlows.length}）
                  </span>
                </h2>
                <p className="text-sm text-muted-foreground">
                  あるべき姿の業務フローを選んで開く / 新規作成する
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/dashboard/projects/${projectId}/flows`}>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Folder className="h-4 w-4" />
                    フォルダ
                  </Button>
                </Link>
                <Link href={`/dashboard/projects/${projectId}/flows/hierarchy`}>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <FolderTree className="h-4 w-4" />
                    階層
                  </Button>
                </Link>
                <Button
                  size="sm"
                  onClick={() => setIsCreateOpen(true)}
                  className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                >
                  <Plus className="h-4 w-4" />
                  あるべき姿を追加
                </Button>
              </div>
            </div>

            {tobeFlows.length === 0 ? (
              <Card className="border-dashed border-emerald-200 bg-emerald-50/40">
                <CardContent className="py-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    TOBE業務フローはまだありません。「あるべき姿を追加」からあるべき姿フローを追加しましょう。
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {tobeFlows.map((flow) => {
                  const sp = subProjectName(flow.subProjectId);
                  const fd = folderName(flow.folderId);
                  return (
                    <button
                      key={flow.id}
                      type="button"
                      onClick={() => openFlow(flow.id)}
                      className="group flex w-full flex-col items-start gap-2 rounded-lg border border-gray-200 bg-white p-4 text-left transition-colors hover:border-emerald-400 hover:bg-emerald-50/40"
                    >
                      <div className="flex w-full items-start justify-between gap-2">
                        <span className="flex items-center gap-2 font-medium text-foreground">
                          <GitBranch className="h-4 w-4 shrink-0 text-emerald-600" />
                          <span className="truncate">{flow.name}</span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 group-hover:text-emerald-600" />
                      </div>
                      {(sp || fd) && (
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          {fd && (
                            <span className="inline-flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5">
                              <Folder className="h-3 w-3" />
                              {fd}
                            </span>
                          )}
                          {sp && (
                            <span className="inline-flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5">
                              <Layers className="h-3 w-3" />
                              {sp}
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Section: あるべき姿・打ち手 ───────────────────── */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
                  <Sparkles className="h-5 w-5 text-emerald-600" />
                  あるべき姿・打ち手
                </h2>
                <p className="text-sm text-muted-foreground">
                  領域ごとのあるべき姿と打ち手・期待効果を整理する
                </p>
              </div>
              <Link href={`/dashboard/projects/${projectId}/issue-trees`}>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Network className="h-4 w-4" />
                  打ち手ツリー（課題ツリー）
                </Button>
              </Link>
            </div>
            <EditableMemoBoard<TobeVision, TobeVisionInput>
              projectId={projectId}
              api={tobeVisionApi}
              entityLabel="あるべき姿"
              columns={[
                // 領域は ASIS と共通の SubProject マスタから選択（データ連携の主役）。
                {
                  key: 'subProjectId',
                  label: '領域',
                  kind: 'select',
                  options: subProjectOptions,
                  emptyLabel: '未分類',
                },
                { key: 'vision', label: 'あるべき姿', kind: 'multiline' },
                { key: 'countermeasure', label: '打ち手', kind: 'multiline' },
                { key: 'effect', label: '期待効果', kind: 'multiline' },
                // 旧フリーテキストの領域メモ（後方互換のため残置）。
                { key: 'area', label: '領域メモ（自由記述）', kind: 'text' },
              ]}
            />
          </section>

          {/* ── Section: 段階設計（TOBE3段階） ───────────────── */}
          <section className="space-y-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
                <Milestone className="h-5 w-5 text-emerald-600" />
                段階設計（TOBE3段階）
              </h2>
              <p className="text-sm text-muted-foreground">
                打ち手を 3ヶ月(Quick Win)/1年(Phase2)/3年(Phase3) に分け、ROI÷実装コスト＝回収期間でスコープ判断する
              </p>
            </div>
            <EditableMemoBoard<TobeRoadmap, TobeRoadmapInput>
              projectId={projectId}
              api={tobeRoadmapApi}
              entityLabel="段階設計"
              columns={[
                { key: 'phase', label: 'フェーズ', kind: 'text' },
                // 「あるべき姿・打ち手」テーブルの行を選んで紐づける（データ連携）。
                {
                  key: 'tobeVisionId',
                  label: '紐づく打ち手（あるべき姿）',
                  kind: 'select',
                  options: tobeVisionOptions,
                  emptyLabel: '未選択',
                },
                // 領域は ASIS と共通の SubProject マスタから選択。
                {
                  key: 'subProjectId',
                  label: '領域',
                  kind: 'select',
                  options: subProjectOptions,
                  emptyLabel: '未分類',
                },
                { key: 'measure', label: '打ち手（補足）', kind: 'multiline' },
                { key: 'roi', label: 'ROI', kind: 'text' },
                { key: 'cost', label: '実装コスト', kind: 'text' },
                { key: 'payback', label: '回収期間', kind: 'text' },
                { key: 'scope', label: 'スコープ判断', kind: 'multiline' },
              ]}
            />
          </section>
        </>
      )}

      {/* ── あるべき姿（TOBEフロー）作成ダイアログ ───────────── */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="bg-white text-gray-900">
          <DialogHeader>
            <DialogTitle>あるべき姿（TOBE業務フロー）を追加</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="tobe-flow-name">フロー名</Label>
              <Input
                id="tobe-flow-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例: 仕入先発注（あるべき姿）"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                }}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tobe-flow-subproject">領域／サブ領域</Label>
              <select
                id="tobe-flow-subproject"
                value={newSubProjectId}
                onChange={(e) => setNewSubProjectId(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-400"
              >
                <option value={UNASSIGNED}>未分類</option>
                {flatSubProjects.map(({ sub, depth }) => (
                  <option key={sub.id} value={sub.id}>
                    {`${'　'.repeat(depth)}${sub.name}`}
                  </option>
                ))}
              </select>
              {/* ASIS と同じ領域マスタを共有していることを明示。管理は「領域」ページで。 */}
              <p className="text-xs text-muted-foreground">
                領域／サブ領域は ASIS と共通のマスタです。追加・編集は{' '}
                <Link
                  href={`/dashboard/projects/${projectId}/domains`}
                  className="text-emerald-600 hover:underline"
                >
                  サイドメニューの「領域」
                </Link>
                {' '}から行えます。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tobe-flow-desc">説明（任意）</Label>
              <Input
                id="tobe-flow-desc"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="このフローの概要"
              />
            </div>
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
              disabled={creating || !newName.trim()}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              作成して開く
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
