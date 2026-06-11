'use client';

/**
 * ASIS⇔TOBE 比較ビュー。
 *
 * ASIS フローと、それに対応する TOBE フローを「1つのコンテナを上下50/50に分けた
 * 閲覧用ビューア」で比較する。コンテナ全体で1つの全画面トグルを持つ。
 * 対応付けは BusinessFlow.asisFlowId（TOBEフロー → 対応ASISフロー）で解決する。
 *
 *  - useSearchParams で asis(=ASISフローID) / tobe(=TOBEフローID) を受ける。
 *    片方/両方欠ける場合は上部にセレクタを出し、ASIS を選ぶと対応 TOBE
 *    （tobeFlows.find(t => t.asisFlowId === asisId)）を自動選択する。
 *  - 各ペインは既存 SwimlaneCanvas を embedded（閲覧用埋め込み）で流用する。
 *    embedded のとき SwimlaneCanvas 自前のツールバー/全画面/IO候補パネル/パンくず
 *    バッジは描画されない。編集系コールバック（onXxx）も一切渡さない。
 *  - 全画面はこのページの1つのトグル（isCompareFullscreen）のみ。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useParams, useRouter, useSearchParams } from 'next/navigation';
import { Loader2, GitCompare, Maximize2, Minimize2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { SwimlaneCanvas } from '@/components/flow-editor/SwimlaneCanvas';
import type { FlowData, FlowSummary, Role } from '@/components/flow-editor/flow-types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

function getHeaders(): Record<string, string> {
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/**
 * 比較コンテナ内の1ペイン（上=ASIS / 下=TOBE）。relative で SwimlaneCanvas を満たし、
 * 左上に小さなラベル（色バッジ + フロー名）をオーバーレイ表示する。
 * 未選択/未取得ならプレースホルダを表示する。
 */
function ComparePane({
  label,
  badgeClass,
  flowData,
  roles,
  projectId,
  loading,
  emptyLabel,
}: {
  label: string;
  badgeClass: string;
  flowData: FlowData | null;
  roles: Role[];
  projectId: string;
  loading: boolean;
  emptyLabel: string;
}) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-white">
      {/* 左上ラベル（オーバーレイ）。SwimlaneCanvas 自前のパンくずは embedded で消えている。 */}
      <div className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${badgeClass}`}>
          {label}
        </span>
        {flowData && (
          <span className="max-w-[40vw] truncate rounded bg-white/80 px-1.5 py-0.5 text-xs font-medium text-gray-700 shadow-sm">
            {flowData.name}
          </span>
        )}
      </div>
      {loading ? (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : flowData ? (
        // 編集系コールバックは渡さない＝閲覧用途。embedded で自前ツールバー等を隠す。
        <SwimlaneCanvas flowData={flowData} roles={roles} projectId={projectId} embedded />
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      )}
    </div>
  );
}

export default function FlowComparePage() {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;

  // URL クエリの asis / tobe（選択の単一ソース）。
  const asisParam = searchParams.get('asis');
  const tobeParam = searchParams.get('tobe');

  const [flowSummaries, setFlowSummaries] = useState<FlowSummary[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);

  // 選択中の ASIS / TOBE フローID（null=未選択）。
  const [asisId, setAsisId] = useState<string | null>(asisParam);
  const [tobeId, setTobeId] = useState<string | null>(tobeParam);

  // コンテナ全体の全画面トグル（SwimlaneCanvas 自前の全画面は embedded で消えている）。
  const [isCompareFullscreen, setIsCompareFullscreen] = useState(false);

  // URL → state 同期。同一ルートのままクエリだけ変わる遷移（クライアントナビ・
  // ブラウザ戻る/進む・URL手編集）でも表示中フローを追従させる。
  // セレクタ操作は handleSelectAsis/handleSelectTobe で先に URL を更新するため、
  // この effect はそれを state に反映するだけで巻き戻しは起きない（URL が単一ソース）。
  useEffect(() => {
    setAsisId(asisParam);
    setTobeId(tobeParam);
  }, [asisParam, tobeParam]);

  const [asisFlow, setAsisFlow] = useState<FlowData | null>(null);
  const [tobeFlow, setTobeFlow] = useState<FlowData | null>(null);

  const [listLoading, setListLoading] = useState(true);
  const [asisLoading, setAsisLoading] = useState(false);
  const [tobeLoading, setTobeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // フロー一覧（セレクタ＋対応解決用）とロール一覧を取得。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setListLoading(true);
      setError(null);
      try {
        const headers = getHeaders();
        const [flowRes, rolesRes] = await Promise.all([
          fetch(`${API_URL}/api/business-flows/project/${projectId}/all`, { headers }),
          fetch(`${API_URL}/api/roles/project/${projectId}`, { headers }),
        ]);
        if (!cancelled && flowRes.ok) {
          const data = await flowRes.json();
          setFlowSummaries(Array.isArray(data) ? data : []);
        } else if (!cancelled) {
          setError('業務フローの読み込みに失敗しました');
        }
        if (!cancelled && rolesRes.ok) {
          const data = await rolesRes.json();
          setRoles(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error('Failed to fetch compare data:', err);
        if (!cancelled) setError('読み込み中にエラーが発生しました');
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const asisFlows = useMemo(
    () => flowSummaries.filter((f) => f.kind === 'ASIS'),
    [flowSummaries]
  );
  const tobeFlows = useMemo(
    () => flowSummaries.filter((f) => f.kind === 'TOBE'),
    [flowSummaries]
  );

  // ASIS を選んだとき、対応する TOBE（asisFlowId 一致）を自動選択する。
  // FlowSummary.asisFlowId は project/:id/all（toResponse）が返す正式フィールド。
  const tobeForAsis = useCallback(
    (id: string): string | null => {
      const matched = tobeFlows.find((t) => t.asisFlowId === id);
      return matched?.id ?? null;
    },
    [tobeFlows]
  );

  // 選択を URL クエリへ反映（単一ソース化）。state は上の URL→state effect で追従する。
  const pushSelection = useCallback(
    (nextAsis: string | null, nextTobe: string | null) => {
      const sp = new URLSearchParams();
      if (nextAsis) sp.set('asis', nextAsis);
      if (nextTobe) sp.set('tobe', nextTobe);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname]
  );

  // ASIS セレクタ変更: 対応 TOBE を自動選択（無ければ現状維持）。
  const handleSelectAsis = useCallback(
    (id: string | null) => {
      const auto = id ? tobeForAsis(id) : null;
      pushSelection(id, auto ?? tobeId);
    },
    [tobeForAsis, pushSelection, tobeId]
  );

  // TOBE セレクタ変更。
  const handleSelectTobe = useCallback(
    (id: string | null) => {
      pushSelection(asisId, id);
    },
    [pushSelection, asisId]
  );

  // ASIS フロー詳細を取得。
  useEffect(() => {
    if (!asisId) {
      setAsisFlow(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setAsisLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/business-flows/${asisId}`, {
          headers: getHeaders(),
        });
        if (!cancelled && res.ok) setAsisFlow(await res.json());
        else if (!cancelled) setAsisFlow(null);
      } catch (err) {
        console.error('Failed to fetch ASIS flow:', err);
        if (!cancelled) setAsisFlow(null);
      } finally {
        if (!cancelled) setAsisLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [asisId]);

  // TOBE フロー詳細を取得。
  useEffect(() => {
    if (!tobeId) {
      setTobeFlow(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setTobeLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/business-flows/${tobeId}`, {
          headers: getHeaders(),
        });
        if (!cancelled && res.ok) setTobeFlow(await res.json());
        else if (!cancelled) setTobeFlow(null);
      } catch (err) {
        console.error('Failed to fetch TOBE flow:', err);
        if (!cancelled) setTobeFlow(null);
      } finally {
        if (!cancelled) setTobeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tobeId]);

  // Esc で全画面解除（入力欄フォーカス中は無視）。
  useEffect(() => {
    if (!isCompareFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) {
        return;
      }
      setIsCompareFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isCompareFullscreen]);

  // 戻る導線（ASIS 管理へ）。
  const backHref = `/dashboard/projects/${projectId}/asis`;

  // 対になっているフロー名（あれば）をヘッダー説明に出す。
  const pairLabel = useMemo(() => {
    const a = asisFlow?.name ?? asisFlows.find((f) => f.id === asisId)?.name;
    const t = tobeFlow?.name ?? tobeFlows.find((f) => f.id === tobeId)?.name;
    if (a && t) return `${a} ⇔ ${t}`;
    if (a) return `${a}（対応TOBE未選択）`;
    if (t) return `${t}（対応ASIS未選択）`;
    return '比較するフローを選択してください';
  }, [asisFlow, tobeFlow, asisFlows, tobeFlows, asisId, tobeId]);

  // 片方でも欠けていればセレクタを出す。
  const showSelectors = !asisId || !tobeId;

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <GitCompare className="h-6 w-6 text-indigo-600" />
            ASIS⇔TOBE 比較
          </span>
        }
        description={pairLabel}
        help="現状（ASIS）とあるべき姿（TOBE）の業務フローを上下に並べて比較します。対応付けはTOBEフローの「対応ASIS」で設定します。"
        backHref={backHref}
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* どちらか欠ける場合はセレクタを出す。 */}
      {showSelectors && (
        <div className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>ASISフロー</span>
            <select
              value={asisId ?? ''}
              onChange={(e) => handleSelectAsis(e.target.value || null)}
              className="min-w-[16rem] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            >
              <option value="">選択してください</option>
              {asisFlows.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>TOBEフロー</span>
            <select
              value={tobeId ?? ''}
              onChange={(e) => handleSelectTobe(e.target.value || null)}
              className="min-w-[16rem] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            >
              <option value="">選択してください</option>
              {tobeFlows.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {/* 1つのコンテナを縦に2分割（上=ASIS / 下=TOBE）。全体で1つの全画面トグル。
          全画面時は fixed inset-0 で前面に出るためヘッダー/セレクタは自然に隠れる。 */}
      <div
        className={
          isCompareFullscreen
            ? 'fixed inset-0 z-50 flex flex-col bg-white'
            : 'relative flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white'
        }
        style={isCompareFullscreen ? undefined : { height: 'calc(100vh - 220px)', minHeight: '480px' }}
      >
        {/* 全体で1つの全画面ボタン（右上オーバーレイ）。 */}
        <button
          type="button"
          onClick={() => setIsCompareFullscreen((v) => !v)}
          className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          title={isCompareFullscreen ? '全画面を解除（Esc）' : '全画面表示'}
        >
          {isCompareFullscreen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
          {isCompareFullscreen ? '縮小' : '全画面'}
        </button>

        {/* 上半分（50%）= ASIS */}
        <div className="min-h-0 flex-1">
          <ComparePane
            label="ASIS"
            badgeClass="bg-blue-100 text-blue-700"
            flowData={asisFlow}
            roles={roles}
            projectId={projectId}
            loading={listLoading || asisLoading}
            emptyLabel="対応するフローがありません / ASISフローを選択してください"
          />
        </div>

        {/* 区切り線 */}
        <div className="h-px shrink-0 bg-gray-300" />

        {/* 下半分（50%）= TOBE */}
        <div className="min-h-0 flex-1">
          <ComparePane
            label="TOBE"
            badgeClass="bg-emerald-100 text-emerald-700"
            flowData={tobeFlow}
            roles={roles}
            projectId={projectId}
            loading={listLoading || tobeLoading}
            emptyLabel="対応するフローがありません / TOBEフローを選択してください"
          />
        </div>
      </div>
    </div>
  );
}
