'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  GitBranch,
  Plus,
  Loader2,
  FolderTree,
  Layers,
  ChevronRight,
  Target,
  Sparkles,
  Network,
  Milestone,
  Columns2,
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
import { EditGate } from '@/components/edit-gate';
import { useReadOnly } from '@/components/read-only-context';
import { FeatureSectionIo } from '@/components/io/FeatureSectionIo';
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
import { SubProjectPicker } from '@/components/ui/sub-project-picker';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

type FlowKind = 'ASIS' | 'TOBE';

type BusinessFlow = {
  id: string;
  name: string;
  kind: FlowKind;
  subProjectId?: string | null;
  description?: string | null;
  // TOBE→対応ASIS の紐づけ（TOBEフローのみ使用。null=未設定）。
  asisFlowId?: string | null;
};

// 領域（SubProject）は ASIS と共通の SubProject マスタ。parentId で 領域→サブ領域 の入れ子を持つ。
type SubProject = SubProjectMaster;

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

// 領域でグループ化したので、カードは領域バッジを省略しフロー名のみを表示する。
// カード下部に「対応ASIS」セレクタを置き、選択でこのTOBEフロー自身の asisFlowId を更新する。
function FlowCard({
  flow,
  projectId,
  asisFlows,
  onOpen,
  onChangeAsis,
}: {
  flow: BusinessFlow;
  projectId: string;
  asisFlows: BusinessFlow[];
  onOpen: () => void;
  onChangeAsis: (asisFlowId: string | null) => void;
}) {
  return (
    <div
      className="group flex w-full cursor-pointer flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-emerald-400 hover:bg-emerald-50/40"
      onClick={onOpen}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        className="flex w-full items-start justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 font-medium text-foreground">
          <GitBranch className="h-4 w-4 shrink-0 text-emerald-600" />
          <span className="truncate">{flow.name}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 group-hover:text-emerald-600" />
      </button>
      {/* 対応ASIS セレクタ。クリックがカード遷移へ波及しないよう stopPropagation。 */}
      <label
        className="flex items-center gap-2 text-xs text-muted-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="shrink-0">対応ASIS</span>
        <select
          value={flow.asisFlowId ?? UNASSIGNED}
          onChange={(e) =>
            onChangeAsis(e.target.value === UNASSIGNED ? null : e.target.value)
          }
          className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-400"
        >
          <option value={UNASSIGNED}>—</option>
          {asisFlows.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {/* 対応ASIS が設定されている時だけ ASIS⇔TOBE 比較ビューへの導線を出す。
          カード本体のクリック（onOpen）へ波及しないよう stopPropagation。 */}
      {flow.asisFlowId && (
        <Link
          href={`/dashboard/projects/${projectId}/flows/compare?asis=${flow.asisFlowId}&tobe=${flow.id}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 self-start text-xs font-medium text-indigo-600 hover:underline"
        >
          <Columns2 className="h-3.5 w-3.5" />
          比較
        </Link>
      )}
    </div>
  );
}

export default function TobeManagementPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const { canEdit } = useReadOnly();

  const [flows, setFlows] = useState<BusinessFlow[]>([]);
  const [subProjects, setSubProjects] = useState<SubProject[]>([]);
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
      const [flowRes, subProjectsData, tobeVisionsData] = await Promise.all([
        fetch(`${API_URL}/api/business-flows/project/${projectId}/all`, {
          headers: authHeaders(),
        }),
        subProjectApi.list(projectId).catch(() => [] as SubProject[]),
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

  // あるべき姿・打ち手の「対応するASIS」select 用：ASIS 業務フローの一覧。
  const asisFlows = useMemo(
    () => flows.filter((f) => f.kind === 'ASIS'),
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

  // 領域でグループ分割した一覧を作る。flatSubProjects の順に各領域の配下フローを集め、
  // 最後に「未分類（領域なし）」を置く。フローが 0 件の領域セクションは出さない。
  const flowGroups = useMemo(() => {
    const assigned = new Set<string>();
    const groups = flatSubProjects
      .map(({ sub, depth }) => ({
        sub,
        depth,
        flows: tobeFlows.filter((f) => {
          const match = f.subProjectId === sub.id;
          if (match) assigned.add(f.id);
          return match;
        }),
      }))
      .filter((g) => g.flows.length > 0);
    // 領域が無い / 一覧に存在しない領域を指すフローは「未分類」へ。
    const unassigned = tobeFlows.filter((f) => !assigned.has(f.id));
    return { groups, unassigned };
  }, [flatSubProjects, tobeFlows]);

  // メモボードの select 列用：領域／サブ領域（全角スペースで入れ子インデント）。
  const subProjectOptions = useMemo(
    () =>
      flatSubProjects.map(({ sub, depth }) => ({
        value: sub.id,
        label: `${'　'.repeat(depth)}${sub.name}`,
      })),
    [flatSubProjects]
  );

  // あるべき姿・打ち手の「対応するASIS」select 用：ASIS フローを ID→名前で。
  const asisFlowOptions = useMemo(
    () => asisFlows.map((f) => ({ value: f.id, label: f.name })),
    [asisFlows]
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

  // TOBEフローの「対応ASIS」を更新する。そのフロー自身を PUT し、成功したらローカル flows を更新。
  const handleChangeAsis = async (
    tobeFlowId: string,
    asisFlowId: string | null
  ) => {
    setError(null);
    // 楽観的更新（失敗時に元へ戻す）。
    const prev = flows;
    setFlows((cur) =>
      cur.map((f) => (f.id === tobeFlowId ? { ...f, asisFlowId } : f))
    );
    try {
      const res = await fetch(`${API_URL}/api/business-flows/${tobeFlowId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ asisFlowId }),
      });
      if (!res.ok) {
        setFlows(prev);
        setError('対応ASISの更新に失敗しました');
      }
    } catch (err) {
      console.error('Failed to update asisFlowId:', err);
      setFlows(prev);
      setError('対応ASISの更新中にエラーが発生しました');
    }
  };

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
          <>
            <HowToPanel
              title="TOBE管理の使い方"
              steps={[
                'TOBE業務フローのカードをクリックすると、そのフローを開いて編集できます。',
                '「あるべき姿を追加」で領域（ASISと共通）を選んで新しいあるべき姿フローを作成し、そのまま編集画面に移動します。',
                'あるべき姿・打ち手の表に、領域ごとのあるべき姿と打ち手・期待効果を書き留めます。',
                '段階設計の表で、打ち手を 3ヶ月/1年/3年 に割り当て、ROI・コスト・回収期間・スコープ判断を整理します。',
              ]}
            />
            <FeatureSectionIo
              projectId={projectId}
              sectionKey="tobe"
              label="TOBE（あるべき姿・打ち手）"
              canEdit={canEdit}
              onDone={() => void fetchAll()}
            />
          </>
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
        <EditGate dim={false}>
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
                <Link
                  href={`/dashboard/projects/${projectId}/domains`}
                  className="text-xs text-emerald-600 hover:underline"
                >
                  領域を管理
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
              <div className="space-y-6">
                {/* 領域（SubProject）ごとにグループ分割して表示する。 */}
                {flowGroups.groups.map(({ sub, depth, flows: groupFlows }) => (
                  <div key={sub.id} className="space-y-3">
                    <h3
                      className="flex items-center gap-2 text-sm font-semibold text-foreground"
                      // depth に応じて左インデント（サブ領域を一段下げる）。
                      style={{ paddingLeft: `${depth * 1.25}rem` }}
                    >
                      <Layers className="h-4 w-4 shrink-0 text-emerald-600" />
                      {sub.name}
                      <span className="text-xs font-normal text-muted-foreground">
                        （{groupFlows.length}）
                      </span>
                    </h3>
                    <div
                      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
                      style={{ paddingLeft: `${depth * 1.25}rem` }}
                    >
                      {groupFlows.map((flow) => (
                        <FlowCard
                          key={flow.id}
                          flow={flow}
                          projectId={projectId}
                          asisFlows={asisFlows}
                          onOpen={() => openFlow(flow.id)}
                          onChangeAsis={(asisFlowId) =>
                            handleChangeAsis(flow.id, asisFlowId)
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))}

                {/* 未分類（領域なし／一覧に無い領域を指すフロー）。0 件なら出さない。 */}
                {flowGroups.unassigned.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                      <Layers className="h-4 w-4 shrink-0 text-gray-400" />
                      未分類（領域なし）
                      <span className="text-xs font-normal text-muted-foreground">
                        （{flowGroups.unassigned.length}）
                      </span>
                    </h3>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {flowGroups.unassigned.map((flow) => (
                        <FlowCard
                          key={flow.id}
                          flow={flow}
                          projectId={projectId}
                          asisFlows={asisFlows}
                          onOpen={() => openFlow(flow.id)}
                          onChangeAsis={(asisFlowId) =>
                            handleChangeAsis(flow.id, asisFlowId)
                          }
                        />
                      ))}
                    </div>
                  </div>
                )}
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
                // 対応する ASIS 業務フロー（kind='ASIS'）を選んで紐づける（データ連携）。
                {
                  key: 'asisFlowId',
                  label: '対応するASIS',
                  kind: 'select',
                  options: asisFlowOptions,
                  emptyLabel: '—',
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
        </EditGate>
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
              <Label>領域／サブ領域</Label>
              <div>
                {/* 共通の領域ピッカー（ツリー＋検索）。クリアで未分類（UNASSIGNED）に戻す。 */}
                <SubProjectPicker
                  subProjects={subProjects}
                  value={newSubProjectId === UNASSIGNED ? '' : newSubProjectId}
                  onChange={(v) =>
                    setNewSubProjectId(v === '' ? UNASSIGNED : v)
                  }
                  placeholder="領域を選択"
                />
              </div>
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
