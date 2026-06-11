'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  GitBranch,
  Plus,
  Loader2,
  FolderTree,
  Database,
  GitCompare,
  ClipboardList,
  Layers,
  ChevronRight,
  Columns2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  asisMemoApi,
  type AsisMemo,
  type AsisMemoInput,
} from '@/lib/asis-tobe';
// 領域（SubProject）は TOBE と共通の SubProject マスタから取得する（@/lib/masters に統一）。
import { subProjectApi, type SubProjectMaster } from '@/lib/masters';

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

// 領域（SubProject）は TOBE と共通の SubProject マスタ。parentId で 領域→サブ領域 の入れ子を持つ。
type SubProject = SubProjectMaster;

// 「未分類」セレクト用のセンチネル（空文字を value にすると未選択と区別しにくいため）。
const UNASSIGNED = '__none__';

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

type GapItem = {
  id: string;
  businessArea: string;
  asisDescription: string | null;
  gapDescription: string | null;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'OPEN' | 'RESOLVED';
};

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

const priorityBadge: Record<GapItem['priority'], string> = {
  HIGH: 'text-red-700 bg-red-50 border-red-300',
  MEDIUM: 'text-amber-700 bg-amber-50 border-amber-300',
  LOW: 'text-green-700 bg-green-50 border-green-300',
};

// 領域でグループ化したので、カードは領域バッジを省略しフロー名のみを表示する。
// カード下部に「対応TOBE」セレクタを置き、選択した TOBE フロー側の asisFlowId を
// このASISフローID に設定する（紐づけは BusinessFlow.asisFlowId に保存される）。
function FlowCard({
  flow,
  projectId,
  tobeFlows,
  linkedTobeId,
  onOpen,
  onChangeTobe,
}: {
  flow: BusinessFlow;
  projectId: string;
  tobeFlows: BusinessFlow[];
  linkedTobeId: string | null;
  onOpen: () => void;
  onChangeTobe: (tobeFlowId: string | null) => void;
}) {
  return (
    <div className="group flex w-full flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-amber-400 hover:bg-amber-50/40">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 font-medium text-foreground">
          <GitBranch className="h-4 w-4 shrink-0 text-amber-600" />
          <span className="truncate">{flow.name}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 group-hover:text-amber-600" />
      </button>
      {/* 対応TOBE セレクタ。クリックがカード遷移へ波及しないよう stopPropagation。 */}
      <label
        className="flex items-center gap-2 text-xs text-muted-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="shrink-0">対応TOBE</span>
        <select
          value={linkedTobeId ?? UNASSIGNED}
          onChange={(e) =>
            onChangeTobe(e.target.value === UNASSIGNED ? null : e.target.value)
          }
          className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-amber-400"
        >
          <option value={UNASSIGNED}>—</option>
          {tobeFlows.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {/* 対応TOBE が設定されている時だけ ASIS⇔TOBE 比較ビューへの導線を出す。
          カード本体のクリック（onOpen）へ波及しないよう stopPropagation。 */}
      {linkedTobeId && (
        <Link
          href={`/dashboard/projects/${projectId}/flows/compare?asis=${flow.id}&tobe=${linkedTobeId}`}
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

export default function AsisManagementPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;

  const [flows, setFlows] = useState<BusinessFlow[]>([]);
  const [subProjects, setSubProjects] = useState<SubProject[]>([]);
  const [gapItems, setGapItems] = useState<GapItem[]>([]);
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
      // 領域（SubProject）は TOBE と共通の subProjectApi.list で取得する。
      const [flowRes, subProjectsData, gapRes] = await Promise.all([
        fetch(`${API_URL}/api/business-flows/project/${projectId}/all`, {
          headers: authHeaders(),
        }),
        subProjectApi.list(projectId).catch(() => [] as SubProject[]),
        fetch(`${API_URL}/api/projects/${projectId}/gap-items`, {
          headers: authHeaders(),
        }),
      ]);

      if (flowRes.ok) {
        const data = await flowRes.json();
        setFlows(Array.isArray(data) ? data : []);
      } else {
        setError('業務フローの読み込みに失敗しました');
      }
      setSubProjects(Array.isArray(subProjectsData) ? subProjectsData : []);
      if (gapRes.ok) {
        const data = await gapRes.json();
        setGapItems(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch ASIS data:', err);
      setError('読み込み中にエラーが発生しました');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const asisFlows = useMemo(
    () => flows.filter((f) => f.kind === 'ASIS'),
    [flows]
  );

  // 各ASISカードの「対応TOBE」セレクタ用：TOBE 業務フローの一覧。
  const tobeFlows = useMemo(
    () => flows.filter((f) => f.kind === 'TOBE'),
    [flows]
  );

  // 領域→サブ領域 を入れ子（DFS）で並べたセレクタ用の一覧。
  const flatSubProjects = useMemo(
    () => flattenSubProjects(subProjects),
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
        flows: asisFlows.filter((f) => {
          const match = f.subProjectId === sub.id;
          if (match) assigned.add(f.id);
          return match;
        }),
      }))
      .filter((g) => g.flows.length > 0);
    // 領域が無い / 一覧に存在しない領域を指すフローは「未分類」へ。
    const unassigned = asisFlows.filter((f) => !assigned.has(f.id));
    return { groups, unassigned };
  }, [flatSubProjects, asisFlows]);

  const openFlow = (id: string) =>
    router.push(`/dashboard/projects/${projectId}/flows/${id}`);

  // 紐づけは TOBE 側の asisFlowId に保存する（選んだ TOBE を PUT）。
  // 単一の TOBE フローの asisFlowId を更新し、成功したらローカル flows を反映する。
  const putTobeAsisFlow = async (
    tobeFlowId: string,
    asisFlowId: string | null
  ) => {
    const res = await fetch(`${API_URL}/api/business-flows/${tobeFlowId}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ asisFlowId }),
    });
    return res.ok;
  };

  // このASISフローに対応づける TOBE を切り替える。
  // 選択した TOBE の asisFlowId を このASISID に設定し、これまで紐づいていた別の TOBE は解除する。
  // 選択解除（null）の場合は、現在紐づいている TOBE の asisFlowId を null にする。
  const handleChangeTobe = async (
    asisFlowId: string,
    nextTobeFlowId: string | null
  ) => {
    setError(null);
    const prevTobe = tobeFlows.find((t) => t.asisFlowId === asisFlowId) ?? null;
    if (prevTobe?.id === nextTobeFlowId) return; // 変化なし

    const prev = flows;
    // 楽観的更新：旧 TOBE を解除し、新 TOBE に このASISID を設定。
    setFlows((cur) =>
      cur.map((f) => {
        if (prevTobe && f.id === prevTobe.id) return { ...f, asisFlowId: null };
        if (nextTobeFlowId && f.id === nextTobeFlowId)
          return { ...f, asisFlowId };
        return f;
      })
    );
    try {
      const tasks: Promise<boolean>[] = [];
      // 以前の紐づけ先（別の TOBE）を解除。
      if (prevTobe && prevTobe.id !== nextTobeFlowId)
        tasks.push(putTobeAsisFlow(prevTobe.id, null));
      // 新たに選んだ TOBE に このASISID を設定。
      if (nextTobeFlowId)
        tasks.push(putTobeAsisFlow(nextTobeFlowId, asisFlowId));
      const results = await Promise.all(tasks);
      if (results.some((ok) => !ok)) {
        setFlows(prev);
        setError('対応TOBEの更新に失敗しました');
      }
    } catch (err) {
      console.error('Failed to update asisFlowId:', err);
      setFlows(prev);
      setError('対応TOBEの更新中にエラーが発生しました');
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
          kind: 'ASIS',
          description: newDescription.trim() || undefined,
          // TOBE と共通の SubProject マスタから選んだ領域／サブ領域。未分類なら null。
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
        setError('ASISフローの作成に失敗しました');
      }
    } catch (err) {
      console.error('Failed to create ASIS flow:', err);
      setError('作成中にエラーが発生しました');
    } finally {
      setCreating(false);
    }
  };

  const openGapItems = gapItems.filter((g) => g.status === 'OPEN');

  return (
    <div className="space-y-8">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-amber-600" />
            ASIS管理
          </span>
        }
        description="現状（ASIS）の業務フロー・データ・課題・状態を一元管理"
        help="このページで現状（ASIS）の業務フローを選んで開き、現状のデータ・課題・状態メモを一箇所で管理します。"
        actions={
          <HowToPanel
            title="ASIS管理の使い方"
            steps={[
              'ASIS業務フローのカードをクリックすると、そのフローを開いて編集できます。',
              '「ASISフロー作成」で新しい現状フローを作成し、そのまま編集画面に移動します。',
              '現状のデータはデータカタログ、課題はGAP一覧へのリンクから確認・編集できます。',
              '現状メモ（状態）の表に、項目ごとの現状・課題・制約を自由に書き留めます。',
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
          <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
        </div>
      ) : (
        <>
          {/* ── Section: ASIS業務フロー ───────────────────────── */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
                  <GitBranch className="h-5 w-5 text-amber-600" />
                  ASIS業務フロー
                  <span className="text-sm font-normal text-muted-foreground">
                    （{asisFlows.length}）
                  </span>
                </h2>
                <p className="text-sm text-muted-foreground">
                  現状の業務フローを選んで開く / 新規作成する
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/dashboard/projects/${projectId}/domains`}
                  className="text-xs text-amber-600 hover:underline"
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
                  className="gap-1.5 bg-amber-600 hover:bg-amber-700"
                >
                  <Plus className="h-4 w-4" />
                  ASISフロー作成
                </Button>
              </div>
            </div>

            {asisFlows.length === 0 ? (
              <Card className="border-dashed border-amber-200 bg-amber-50/40">
                <CardContent className="py-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    ASIS業務フローはまだありません。「ASISフロー作成」から現状フローを追加しましょう。
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
                      <Layers className="h-4 w-4 shrink-0 text-amber-600" />
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
                          tobeFlows={tobeFlows}
                          linkedTobeId={
                            tobeFlows.find((t) => t.asisFlowId === flow.id)
                              ?.id ?? null
                          }
                          onOpen={() => openFlow(flow.id)}
                          onChangeTobe={(tobeFlowId) =>
                            handleChangeTobe(flow.id, tobeFlowId)
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
                          tobeFlows={tobeFlows}
                          linkedTobeId={
                            tobeFlows.find((t) => t.asisFlowId === flow.id)
                              ?.id ?? null
                          }
                          onOpen={() => openFlow(flow.id)}
                          onChangeTobe={(tobeFlowId) =>
                            handleChangeTobe(flow.id, tobeFlowId)
                          }
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── Section: 現状のデータ・課題 ───────────────────── */}
          <section className="space-y-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
                <Database className="h-5 w-5 text-amber-600" />
                現状のデータ・課題
              </h2>
              <p className="text-sm text-muted-foreground">
                現状のデータカタログと、未解決の課題（GAP）を確認する
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Card className="bg-white">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-amber-600" />
                      データカタログ
                    </span>
                    <Link
                      href={`/dashboard/projects/${projectId}/catalog`}
                      className="text-sm font-normal text-blue-600 hover:underline"
                    >
                      開く
                    </Link>
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  現状で扱っているマスタ・テーブル・項目を登録・参照します。
                </CardContent>
              </Card>

              <Card className="bg-white">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="flex items-center gap-2">
                      <GitCompare className="h-4 w-4 text-amber-600" />
                      課題（GAP）
                      <span className="text-sm font-normal text-muted-foreground">
                        未解決 {openGapItems.length} 件
                      </span>
                    </span>
                    <Link
                      href={`/dashboard/projects/${projectId}/gap-items`}
                      className="text-sm font-normal text-blue-600 hover:underline"
                    >
                      開く
                    </Link>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {openGapItems.length === 0 ? (
                    <p className="px-6 pb-6 text-sm text-muted-foreground">
                      未解決の課題はありません。
                    </p>
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {openGapItems.slice(0, 5).map((g) => (
                        <li
                          key={g.id}
                          className="flex items-start gap-2 px-6 py-2 text-sm"
                        >
                          <span
                            className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${priorityBadge[g.priority]}`}
                          >
                            {g.priority}
                          </span>
                          <span className="min-w-0">
                            <span className="font-medium text-foreground">
                              {g.businessArea || '（業務領域未設定）'}
                            </span>
                            {g.gapDescription && (
                              <span className="block truncate text-muted-foreground">
                                {g.gapDescription}
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </section>

          {/* ── Section: 現状メモ（状態） ─────────────────────── */}
          <section className="space-y-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
                <ClipboardList className="h-5 w-5 text-amber-600" />
                現状メモ（状態）
              </h2>
              <p className="text-sm text-muted-foreground">
                項目ごとに現状・課題・痛み・制約を自由に書き留めます
              </p>
            </div>
            <EditableMemoBoard<AsisMemo, AsisMemoInput>
              projectId={projectId}
              api={asisMemoApi}
              entityLabel="現状メモ"
              columns={[
                { key: 'topic', label: '項目', kind: 'text' },
                { key: 'currentState', label: '現状', kind: 'multiline' },
                { key: 'pain', label: '課題・痛み', kind: 'multiline' },
                { key: 'restriction', label: '制約', kind: 'multiline' },
                { key: 'note', label: 'メモ', kind: 'multiline' },
              ]}
            />
          </section>
        </>
      )}

      {/* ── ASISフロー作成ダイアログ ─────────────────────── */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="bg-white text-gray-900">
          <DialogHeader>
            <DialogTitle>ASISフローを作成</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="asis-flow-name">フロー名</Label>
              <Input
                id="asis-flow-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例: 仕入先発注（現状）"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                }}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="asis-flow-subproject">領域／サブ領域</Label>
              <select
                id="asis-flow-subproject"
                value={newSubProjectId}
                onChange={(e) => setNewSubProjectId(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-amber-400"
              >
                <option value={UNASSIGNED}>未分類</option>
                {flatSubProjects.map(({ sub, depth }) => (
                  <option key={sub.id} value={sub.id}>
                    {`${'　'.repeat(depth)}${sub.name}`}
                  </option>
                ))}
              </select>
              {/* TOBE と同じ領域マスタを共有していることを明示。管理は「領域」ページで。 */}
              <p className="text-xs text-muted-foreground">
                領域／サブ領域は TOBE と共通のマスタです。追加・編集は{' '}
                <Link
                  href={`/dashboard/projects/${projectId}/domains`}
                  className="text-amber-600 hover:underline"
                >
                  サイドメニューの「領域」
                </Link>
                {' '}から行えます。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="asis-flow-desc">説明（任意）</Label>
              <Input
                id="asis-flow-desc"
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
              className="gap-1.5 bg-amber-600 hover:bg-amber-700"
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
