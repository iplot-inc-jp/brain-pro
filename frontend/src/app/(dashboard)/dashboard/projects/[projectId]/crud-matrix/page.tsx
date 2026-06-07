'use client';

/**
 * CRUD表（3モード）— 俯瞰思考/要件定義 教材の手法を実装。
 *   ① 機能の洗い出し : エンティティ(テーブル) × ロール → CRUD。非空セルから機能一覧を自動生成。
 *   ② ロール×CRUD権限 : ロール × エンティティ → CRUD。設計バグ（誰も更新不可/外部ロールの削除権/権限過多）を自動警告。
 *   ③ 業務×CRUD(デバッグ) : エンティティ × 業務(フロー) → CRUD。「どの業務がどのデータを触るか」を追跡。
 *
 * データは既存の Table(columns.crudMappings) / Role / BusinessFlow から集計（バックエンド変更なし）。
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  ChevronLeft,
  Loader2,
  Grid3X3,
  AlertTriangle,
  ListChecks,
  ShieldCheck,
  Bug,
  Network,
  GitBranch,
  Plus,
  X,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

type Op = 'CREATE' | 'READ' | 'UPDATE' | 'DELETE';
const OPS: Op[] = ['CREATE', 'READ', 'UPDATE', 'DELETE'];
const OP_LETTER: Record<Op, string> = { CREATE: 'C', READ: 'R', UPDATE: 'U', DELETE: 'D' };
const OP_LABEL: Record<Op, string> = { CREATE: '作成', READ: '参照', UPDATE: '更新', DELETE: '削除' };
const OP_COLOR: Record<Op, string> = {
  CREATE: 'bg-emerald-100 text-emerald-700',
  READ: 'bg-sky-100 text-sky-700',
  UPDATE: 'bg-amber-100 text-amber-700',
  DELETE: 'bg-rose-100 text-rose-700',
};

type Role = { id: string; name: string; type: string; color?: string; order: number };
type Column = { id: string; name: string; crudMappings?: RawMapping[] };
type Table = { id: string; name: string; displayName?: string; columns?: Column[] };
type RawMapping = {
  id: string;
  operation: Op;
  roleId: string;
  flowId?: string | null;
  flowNodeId?: string | null;
  how?: string;
};
type Flow = { id: string; name: string; kind?: string };

// 集計済みマッピング（テーブル粒度）
type Agg = {
  id: string;
  tableId: string;
  operation: Op;
  roleId: string;
  flowId: string | null;
  how?: string;
};

type Mode = 'features' | 'permissions' | 'debug' | 'api-roles' | 'status-roles';

const UNASSIGNED_FLOW = '__none__';

// ④ API×ロール
type ApiRolePermission = { roleId: string; allowed: boolean; note?: string };
type ApiEndpoint = {
  id: string;
  method: string;
  path: string;
  summary?: string | null;
  rolePermissions?: ApiRolePermission[];
};

// ⑤ ステータス×ロール
type StatusRolePermission = { roleId: string; operations: string[]; note?: string };
type TableStatusItem = {
  id: string;
  value: string;
  label?: string | null;
  order: number;
  rolePermissions?: StatusRolePermission[];
};
type TableWithStatuses = {
  id: string;
  name: string;
  displayName?: string;
  statuses?: TableStatusItem[];
};

// ステータス操作の選択肢（C/R/U/D/承認）
const STATUS_OPS = ['C', 'R', 'U', 'D', '承認'] as const;
const STATUS_OP_COLOR: Record<string, string> = {
  C: 'bg-emerald-100 text-emerald-700',
  R: 'bg-sky-100 text-sky-700',
  U: 'bg-amber-100 text-amber-700',
  D: 'bg-rose-100 text-rose-700',
  承認: 'bg-violet-100 text-violet-700',
};

const METHOD_COLOR: Record<string, string> = {
  GET: 'bg-sky-100 text-sky-700',
  POST: 'bg-emerald-100 text-emerald-700',
  PUT: 'bg-amber-100 text-amber-700',
  PATCH: 'bg-amber-100 text-amber-700',
  DELETE: 'bg-rose-100 text-rose-700',
};

export default function CrudMatrixPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [tables, setTables] = useState<Table[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [aggs, setAggs] = useState<Agg[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>('features');
  const [showFeatures, setShowFeatures] = useState(true);

  // セル編集（table × role の操作トグル）
  const [edit, setEdit] = useState<{
    tableId: string;
    tableName: string;
    roleId: string;
    roleName: string;
    ops: Record<Op, boolean>;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  // ④ API×ロール
  const [apiEndpoints, setApiEndpoints] = useState<ApiEndpoint[]>([]);
  const [apiLoading, setApiLoading] = useState(false);

  // ⑤ ステータス×ロール
  const [statusTables, setStatusTables] = useState<TableWithStatuses[]>([]);
  const [statusLoading, setStatusLoading] = useState(false);
  // ステータス×ロールの編集ポップオーバー（statusId+roleId をキーに開閉）
  const [statusEdit, setStatusEdit] = useState<{ statusId: string; roleId: string } | null>(null);
  // 新規ステータス追加中の入力（tableId → value）
  const [newStatus, setNewStatus] = useState<Record<string, string>>({});

  const howToRef = useRef<HTMLSpanElement>(null);

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem('accessToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const headers = getHeaders();
      const [tablesRes, rolesRes, flowsRes] = await Promise.all([
        fetch(`${API_URL}/api/tables/project/${projectId}`, { headers }),
        fetch(`${API_URL}/api/roles/project/${projectId}`, { headers }),
        fetch(`${API_URL}/api/business-flows/project/${projectId}/all`, { headers }),
      ]);
      const tablesData: Table[] = tablesRes.ok ? await tablesRes.json() : [];
      const rolesData: Role[] = rolesRes.ok ? await rolesRes.json() : [];
      const flowsData: Flow[] = flowsRes.ok ? await flowsRes.json() : [];

      // テーブル粒度に集計（同 table×op×role×flow をまとめる）
      const map = new Map<string, Agg>();
      for (const t of tablesData) {
        for (const c of t.columns || []) {
          for (const m of c.crudMappings || []) {
            const flowId = m.flowId ?? null;
            const key = `${t.id}:${m.operation}:${m.roleId}:${flowId ?? ''}`;
            if (!map.has(key)) {
              map.set(key, {
                id: m.id,
                tableId: t.id,
                operation: m.operation,
                roleId: m.roleId,
                flowId,
                how: m.how,
              });
            }
          }
        }
      }

      setTables(tablesData);
      setRoles([...rolesData].sort((a, b) => a.order - b.order));
      setFlows(flowsData);
      setAggs(Array.from(map.values()));
    } catch (err) {
      console.error('Failed to fetch CRUD data:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, getHeaders]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ④ API×ロール データ取得
  const fetchApiEndpoints = useCallback(async () => {
    setApiLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/projects/${projectId}/api-endpoints`, {
        headers: getHeaders(),
      });
      setApiEndpoints(res.ok ? await res.json() : []);
    } catch (err) {
      console.error('Failed to fetch API endpoints:', err);
    } finally {
      setApiLoading(false);
    }
  }, [projectId, getHeaders]);

  // ⑤ ステータス×ロール データ取得
  const fetchStatusTables = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/projects/${projectId}/table-statuses`, {
        headers: getHeaders(),
      });
      setStatusTables(res.ok ? await res.json() : []);
    } catch (err) {
      console.error('Failed to fetch table statuses:', err);
    } finally {
      setStatusLoading(false);
    }
  }, [projectId, getHeaders]);

  useEffect(() => {
    if (mode === 'api-roles') fetchApiEndpoints();
    if (mode === 'status-roles') fetchStatusTables();
  }, [mode, fetchApiEndpoints, fetchStatusTables]);

  // ④ API×ロールの allowed トグル
  const toggleApiRole = async (endpoint: ApiEndpoint, roleId: string) => {
    const current = endpoint.rolePermissions?.find((p) => p.roleId === roleId)?.allowed ?? false;
    // 楽観的更新
    setApiEndpoints((prev) =>
      prev.map((e) => {
        if (e.id !== endpoint.id) return e;
        const perms = e.rolePermissions ? [...e.rolePermissions] : [];
        const idx = perms.findIndex((p) => p.roleId === roleId);
        if (idx >= 0) perms[idx] = { ...perms[idx], allowed: !current };
        else perms.push({ roleId, allowed: !current });
        return { ...e, rolePermissions: perms };
      }),
    );
    try {
      await fetch(`${API_URL}/api/api-endpoints/${endpoint.id}/roles/${roleId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ allowed: !current }),
      });
    } catch (err) {
      console.error('Failed to toggle API role permission:', err);
      fetchApiEndpoints();
    }
  };

  // ⑤ ステータス×ロールの operations を保存
  const saveStatusRoleOps = async (statusId: string, roleId: string, operations: string[]) => {
    // 楽観的更新
    setStatusTables((prev) =>
      prev.map((t) => ({
        ...t,
        statuses: (t.statuses || []).map((s) => {
          if (s.id !== statusId) return s;
          const perms = s.rolePermissions ? [...s.rolePermissions] : [];
          const idx = perms.findIndex((p) => p.roleId === roleId);
          if (idx >= 0) perms[idx] = { ...perms[idx], operations };
          else perms.push({ roleId, operations });
          return { ...s, rolePermissions: perms };
        }),
      })),
    );
    try {
      await fetch(`${API_URL}/api/statuses/${statusId}/roles/${roleId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ operations }),
      });
    } catch (err) {
      console.error('Failed to save status role permission:', err);
      fetchStatusTables();
    }
  };

  // ⑤ テーブルにステータスを追加
  const addStatus = async (tableId: string) => {
    const value = (newStatus[tableId] || '').trim();
    if (!value) return;
    try {
      await fetch(`${API_URL}/api/tables/${tableId}/statuses`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ value }),
      });
      setNewStatus((prev) => ({ ...prev, [tableId]: '' }));
      await fetchStatusTables();
    } catch (err) {
      console.error('Failed to add status:', err);
    }
  };

  // (tableId, roleId) → 操作集合
  const opsByTableRole = useMemo(() => {
    const m = new Map<string, Set<Op>>();
    for (const a of aggs) {
      const k = `${a.tableId}:${a.roleId}`;
      if (!m.has(k)) m.set(k, new Set());
      m.get(k)!.add(a.operation);
    }
    return m;
  }, [aggs]);

  // (tableId, flowId) → 操作集合（デバッグ用）
  const opsByTableFlow = useMemo(() => {
    const m = new Map<string, Set<Op>>();
    for (const a of aggs) {
      const fid = a.flowId ?? UNASSIGNED_FLOW;
      const k = `${a.tableId}:${fid}`;
      if (!m.has(k)) m.set(k, new Set());
      m.get(k)!.add(a.operation);
    }
    return m;
  }, [aggs]);

  const tableName = (t: Table) => t.displayName || t.name;

  // 機能一覧（① 非空セル → 「{ロール}が{エンティティ}を{操作}する」）
  const featureList = useMemo(() => {
    const out: { role: string; table: string; op: Op }[] = [];
    for (const t of tables) {
      for (const r of roles) {
        const set = opsByTableRole.get(`${t.id}:${r.id}`);
        if (!set) continue;
        for (const op of OPS) if (set.has(op)) out.push({ role: r.name, table: tableName(t), op });
      }
    }
    return out;
  }, [tables, roles, opsByTableRole]);

  // ② 設計バグ警告
  const warnings = useMemo(() => {
    const w: { level: 'error' | 'warn'; text: string }[] = [];
    for (const t of tables) {
      let anyWrite = false;
      const deleteRoles: Role[] = [];
      for (const r of roles) {
        const set = opsByTableRole.get(`${t.id}:${r.id}`);
        if (!set) continue;
        if (set.has('CREATE') || set.has('UPDATE')) anyWrite = true;
        if (set.has('DELETE')) deleteRoles.push(r);
        // 外部ロール(OTHER)の書込/削除
        if (r.type === 'OTHER' && (set.has('CREATE') || set.has('UPDATE') || set.has('DELETE'))) {
          w.push({ level: 'warn', text: `「${tableName(t)}」を外部ロール「${r.name}」が書き換え可能。スコープ（自社分のみ等）の制限を要件化していますか？` });
        }
      }
      const hasAnyMapping = roles.some((r) => opsByTableRole.has(`${t.id}:${r.id}`));
      if (hasAnyMapping && !anyWrite) {
        w.push({ level: 'error', text: `「${tableName(t)}」は誰も作成/更新できません（参照のみ）。データの発生源が未定義の設計バグの可能性。` });
      }
      if (deleteRoles.length > 1) {
        w.push({ level: 'warn', text: `「${tableName(t)}」の削除権を ${deleteRoles.length} ロール（${deleteRoles.map((r) => r.name).join('・')}）が保持。削除は管理者のみに絞れませんか？（権限過多）` });
      }
    }
    return w;
  }, [tables, roles, opsByTableRole]);

  const openEdit = (t: Table, r: Role) => {
    const set = opsByTableRole.get(`${t.id}:${r.id}`) ?? new Set<Op>();
    setEdit({
      tableId: t.id,
      tableName: tableName(t),
      roleId: r.id,
      roleName: r.name,
      ops: { CREATE: set.has('CREATE'), READ: set.has('READ'), UPDATE: set.has('UPDATE'), DELETE: set.has('DELETE') },
    });
  };

  const handleSave = async () => {
    if (!edit) return;
    const table = tables.find((t) => t.id === edit.tableId);
    const firstColumn = table?.columns?.[0];
    if (!firstColumn) {
      alert('このテーブルにはカラムがありません。先にデータカタログでカラムを追加してください。');
      return;
    }
    setSaving(true);
    try {
      const headers = getHeaders();
      const current = opsByTableRole.get(`${edit.tableId}:${edit.roleId}`) ?? new Set<Op>();
      for (const op of OPS) {
        const want = edit.ops[op];
        const have = current.has(op);
        if (want && !have) {
          await fetch(`${API_URL}/api/tables/crud-mappings`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ columnId: firstColumn.id, operation: op, roleId: edit.roleId }),
          });
        } else if (!want && have) {
          // 該当 (table,op,role) のマッピングを全削除
          const ids = aggs
            .filter((a) => a.tableId === edit.tableId && a.roleId === edit.roleId && a.operation === op)
            .map((a) => a.id);
          for (const id of ids) {
            await fetch(`${API_URL}/api/tables/crud-mappings/${id}`, { method: 'DELETE', headers });
          }
        }
      }
      await fetchData();
      setEdit(null);
    } catch (err) {
      console.error('Failed to save CRUD cell:', err);
    } finally {
      setSaving(false);
    }
  };

  // キーボードショートカット
  useKeyboardShortcuts([
    { combo: '1', handler: () => setMode('features') },
    { combo: '2', handler: () => setMode('permissions') },
    { combo: '3', handler: () => setMode('debug') },
    { combo: '4', handler: () => setMode('api-roles') },
    { combo: '5', handler: () => setMode('status-roles') },
    {
      // セル編集ダイアログが開いていれば保存（ブラウザ保存を抑止）
      combo: 'mod+s',
      handler: () => {
        if (edit && !saving) handleSave();
      },
    },
    {
      combo: 'escape',
      handler: () => {
        setEdit(null);
        setStatusEdit(null);
      },
    },
    {
      combo: 'shift+/',
      handler: () => howToRef.current?.querySelector('button')?.click(),
    },
  ]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const canShow = tables.length > 0 && roles.length > 0;

  // CRUDセル（操作集合 → C R U D バッジ）
  const CrudCell = ({ set, onClick }: { set?: Set<Op>; onClick?: () => void }) => (
    <td
      className={`border border-gray-200 px-2 py-1.5 text-center ${onClick ? 'cursor-pointer hover:bg-blue-50' : ''}`}
      onClick={onClick}
    >
      {set && set.size > 0 ? (
        <div className="flex items-center justify-center gap-0.5">
          {OPS.map((op) =>
            set.has(op) ? (
              <span key={op} className={`inline-flex w-5 h-5 items-center justify-center rounded text-[11px] font-bold ${OP_COLOR[op]}`} title={OP_LABEL[op]}>
                {OP_LETTER[op]}
              </span>
            ) : (
              <span key={op} className="inline-flex w-5 h-5 items-center justify-center text-[11px] text-gray-200">
                {OP_LETTER[op]}
              </span>
            ),
          )}
        </div>
      ) : (
        <span className="text-gray-300 text-sm">—</span>
      )}
    </td>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex items-center gap-4">
          <Link href={`/dashboard/projects/${projectId}`}>
            <Button variant="ghost" size="sm" className="text-gray-600">
              <ChevronLeft className="w-4 h-4 mr-1" />戻る
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              CRUD表
              <HelpTooltip text="CRUD＝C(作成)/R(参照)/U(更新)/D(削除)。データ(エンティティ)に対して各ロール・各業務がどの操作をできるかを一覧化する表で、「機能の洗い出し」「権限設計のバグ検出」「変更時の影響範囲調査」に使う俯瞰思考のツールです。" />
            </h1>
            <p className="text-gray-500 mt-1">エンティティ × ロール / 業務 の操作マトリクス（俯瞰思考）</p>
          </div>
        </div>
        <span ref={howToRef} className="inline-flex">
          <HowToPanel
            steps={[
              '上部のタブで5つの見方を切り替えます。①機能の洗い出し（テーブル×ロール→非空セルから機能一覧を自動生成）、②ロール×CRUD権限（設計バグを自動警告）、③業務×CRUD（どの業務がどのデータを触るかを追跡）、④API×ロール、⑤ステータス×ロール。',
              '①②では表のセルをクリックすると、そのテーブル×ロールに対するC/R/U/Dをチェックして保存できます。',
              '④はセルをクリックでAPI呼び出し許可(●)をトグル。⑤は各テーブルにステータスを追加し、セルをクリックして許可操作を編集します。',
              '②の警告（誰も作成/更新できない・外部ロールの書込/削除・削除権の過多）は設計の見直しポイントです。',
            ]}
            shortcuts={[
              { keys: '1〜5', desc: '表示モード①〜⑤を切り替え' },
              { keys: '⌘/Ctrl+S', desc: 'セル編集中なら保存' },
              { keys: 'Esc', desc: '編集ダイアログ/ポップオーバーを閉じる' },
              { keys: 'Shift+/（?）', desc: 'この操作方法を開く' },
            ]}
          />
        </span>
      </div>

      {/* モード切替 */}
      <div className="inline-flex flex-wrap rounded-lg border border-gray-200 bg-white p-1 text-sm">
        {([
          { m: 'features', icon: ListChecks, label: '① 機能の洗い出し' },
          { m: 'permissions', icon: ShieldCheck, label: '② ロール×CRUD権限' },
          { m: 'debug', icon: Bug, label: '③ 業務×CRUD（デバッグ）' },
          { m: 'api-roles', icon: Network, label: '④ API×ロール' },
          { m: 'status-roles', icon: GitBranch, label: '⑤ ステータス×ロール' },
        ] as const).map(({ m, icon: Icon, label }) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
              mode === m ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* 各モードの説明（? ヘルパー） */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-gray-600">
        <span className="flex items-center gap-1">
          ① 機能の洗い出し
          <HelpTooltip text="テーブル(エンティティ)×ロールの表。各セルに付けたC/R/U/Dから「{ロール}が{エンティティ}を{操作}する」という機能の一覧を自動生成します。要件の抜け漏れチェックに使います。" />
        </span>
        <span className="flex items-center gap-1">
          ② ロール×CRUD権限
          <HelpTooltip text="ロール×エンティティの表で権限を設計します。誰も作成/更新できない（データの発生源が無い）、外部ロールが書込/削除できる、削除権を持つロールが多すぎる、といった設計バグを自動で警告します。" />
        </span>
        <span className="flex items-center gap-1">
          ③ 業務×CRUD
          <HelpTooltip text="エンティティ×業務フローの表。「どの業務がどのデータをC/R/U/Dするか」を追跡します。あるテーブルを変更した時の影響範囲＝そのテーブルに印が付いた業務、という形でデバッグに使えます。" />
        </span>
        <span className="flex items-center gap-1">
          ④ API×ロール
          <HelpTooltip text="APIエンドポイント×ロールの表。各APIをどのロールが呼び出して良いか（許可＝●）を定義します。APIはGitHub連携やAI抽出で登録され、認可設計の俯瞰に使います。" />
        </span>
        <span className="flex items-center gap-1">
          ⑤ ステータス×ロール
          <HelpTooltip text="テーブルのステータス(申請中・承認済など)×ロールの表。各ステータスの行に対し、どのロールがC/R/U/D/承認を行えるかを定義します。ワークフロー（状態遷移）の権限設計に使います。" />
        </span>
      </div>

      {!canShow ? (
        <Card className="bg-white border-gray-200">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <Grid3X3 className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-gray-500 mb-2">CRUD表を表示するには</p>
            <p className="text-sm text-gray-400 mb-4">テーブルとロールを先に作成してください</p>
            <div className="flex gap-2">
              <Link href={`/dashboard/projects/${projectId}/catalog`}><Button variant="outline">データカタログへ</Button></Link>
              <Link href={`/dashboard/projects/${projectId}/roles`}><Button variant="outline">ロール管理へ</Button></Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 凡例（①②③のCRUD系のみ） */}
          {(mode === 'features' || mode === 'permissions' || mode === 'debug') && (
          <div className="flex items-center gap-3 text-xs text-gray-500">
            {OPS.map((op) => (
              <span key={op} className="flex items-center gap-1">
                <span className={`inline-flex w-5 h-5 items-center justify-center rounded text-[11px] font-bold ${OP_COLOR[op]}`}>{OP_LETTER[op]}</span>
                {OP_LABEL[op]}
              </span>
            ))}
            <span className="text-gray-400">｜ セルをクリックで編集</span>
          </div>
          )}

          {/* ① 機能の洗い出し: テーブル × ロール */}
          {mode === 'features' && (
            <>
              <Card className="bg-white border-gray-200 overflow-hidden">
                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="border border-gray-200 px-4 py-3 text-left font-semibold text-gray-700 sticky left-0 bg-gray-50 z-10 min-w-[140px]">エンティティ ＼ ロール</th>
                        {roles.map((r) => (
                          <th key={r.id} className="border border-gray-200 px-3 py-3 text-center font-semibold text-gray-700 min-w-[140px]" style={{ backgroundColor: r.color ? `${r.color}20` : undefined }}>
                            {r.name}
                            {r.type === 'OTHER' && <span className="ml-1 text-[10px] text-rose-500">外部</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tables.map((t, i) => (
                        <tr key={t.id} className={i % 2 ? 'bg-gray-50/50' : 'bg-white'}>
                          <td className="border border-gray-200 px-4 py-2 font-medium text-gray-900 sticky left-0 z-10" style={{ backgroundColor: i % 2 ? '#fafafa' : 'white' }}>
                            <Link href={`/dashboard/projects/${projectId}/catalog/${t.id}`} className="hover:text-blue-600 hover:underline">{tableName(t)}</Link>
                          </td>
                          {roles.map((r) => (
                            <CrudCell key={r.id} set={opsByTableRole.get(`${t.id}:${r.id}`)} onClick={() => openEdit(t, r)} />
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              {/* 機能一覧 自動生成 */}
              <Card className="bg-white border-gray-200">
                <CardContent className="py-4">
                  <button onClick={() => setShowFeatures((v) => !v)} className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                    <ListChecks className="w-4 h-4 text-blue-600" />
                    機能一覧（自動生成）<span className="text-gray-400 font-normal">{featureList.length}件</span>
                  </button>
                  {showFeatures && (
                    featureList.length > 0 ? (
                      <ul className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-sm text-gray-700">
                        {featureList.map((f, idx) => (
                          <li key={idx} className="flex items-center gap-2">
                            <span className={`inline-flex w-5 h-5 items-center justify-center rounded text-[11px] font-bold shrink-0 ${OP_COLOR[f.op]}`}>{OP_LETTER[f.op]}</span>
                            <span><b>{f.role}</b>が<b>{f.table}</b>を{OP_LABEL[f.op]}する</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-sm text-gray-400">セルを埋めると機能一覧がここに生成されます。</p>
                    )
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {/* ② ロール×CRUD権限: ロール × テーブル + 警告 */}
          {mode === 'permissions' && (
            <>
              <Card className="bg-white border-gray-200 overflow-hidden">
                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="border border-gray-200 px-4 py-3 text-left font-semibold text-gray-700 sticky left-0 bg-gray-50 z-10 min-w-[140px]">ロール ＼ エンティティ</th>
                        {tables.map((t) => (
                          <th key={t.id} className="border border-gray-200 px-3 py-3 text-center font-semibold text-gray-700 min-w-[140px]">{tableName(t)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {roles.map((r, i) => (
                        <tr key={r.id} className={i % 2 ? 'bg-gray-50/50' : 'bg-white'}>
                          <td className="border border-gray-200 px-4 py-2 font-medium text-gray-900 sticky left-0 z-10" style={{ backgroundColor: i % 2 ? '#fafafa' : 'white' }}>
                            {r.name}{r.type === 'OTHER' && <span className="ml-1 text-[10px] text-rose-500">外部</span>}
                          </td>
                          {tables.map((t) => (
                            <CrudCell key={t.id} set={opsByTableRole.get(`${t.id}:${r.id}`)} onClick={() => openEdit(t, r)} />
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              <Card className="bg-white border-gray-200">
                <CardContent className="py-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />設計バグ・権限チェック<span className="text-gray-400 font-normal">{warnings.length}件</span>
                  </div>
                  {warnings.length > 0 ? (
                    <ul className="space-y-1.5 text-sm">
                      {warnings.map((wn, idx) => (
                        <li key={idx} className={`flex items-start gap-2 ${wn.level === 'error' ? 'text-rose-700' : 'text-amber-700'}`}>
                          <span className="mt-0.5">{wn.level === 'error' ? '🛑' : '⚠️'}</span>
                          <span>{wn.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-emerald-600">検出された設計バグはありません。</p>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {/* ③ 業務×CRUD（デバッグ）: テーブル × 業務(フロー) */}
          {mode === 'debug' && (
            <Card className="bg-white border-gray-200 overflow-hidden">
              <CardContent className="p-0 overflow-x-auto">
                <p className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100">「どの業務がどのデータを C/R/U/D するか」を追跡。テーブルを変更した時の影響範囲＝そのテーブルに印が付いた業務。</p>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-gray-200 px-4 py-3 text-left font-semibold text-gray-700 sticky left-0 bg-gray-50 z-10 min-w-[140px]">エンティティ ＼ 業務</th>
                      {flows.map((f) => (
                        <th key={f.id} className="border border-gray-200 px-3 py-3 text-center font-semibold text-gray-700 min-w-[130px]">
                          {f.name}{f.kind === 'TOBE' && <span className="ml-1 text-[10px] text-emerald-600">TOBE</span>}
                        </th>
                      ))}
                      <th className="border border-gray-200 px-3 py-3 text-center font-medium text-gray-400 min-w-[110px]">未割当</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tables.map((t, i) => (
                      <tr key={t.id} className={i % 2 ? 'bg-gray-50/50' : 'bg-white'}>
                        <td className="border border-gray-200 px-4 py-2 font-medium text-gray-900 sticky left-0 z-10" style={{ backgroundColor: i % 2 ? '#fafafa' : 'white' }}>{tableName(t)}</td>
                        {flows.map((f) => (
                          <CrudCell key={f.id} set={opsByTableFlow.get(`${t.id}:${f.id}`)} />
                        ))}
                        <CrudCell set={opsByTableFlow.get(`${t.id}:${UNASSIGNED_FLOW}`)} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* ④ API×ロール: APIエンドポイント × ロール（allowed ●/空 トグル） */}
          {mode === 'api-roles' && (
            <Card className="bg-white border-gray-200 overflow-hidden">
              <CardContent className="p-0 overflow-x-auto">
                <p className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100">
                  各APIエンドポイントを、どのロールが呼び出して良いか（許可＝●）。セルをクリックでトグル。APIはGitHub連携やAI抽出で登録されます。
                </p>
                {apiLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                  </div>
                ) : apiEndpoints.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                      <Network className="h-7 w-7 text-gray-400" />
                    </div>
                    <p className="text-gray-500 mb-1">APIエンドポイントがまだありません</p>
                    <p className="text-sm text-gray-400 mb-4">GitHub連携やAI抽出でAPIを取り込んでください</p>
                    <Link href={`/dashboard/projects/${projectId}/integrations`}>
                      <Button variant="outline">連携・抽出へ</Button>
                    </Link>
                  </div>
                ) : (
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="border border-gray-200 px-4 py-3 text-left font-semibold text-gray-700 sticky left-0 bg-gray-50 z-10 min-w-[260px]">API ＼ ロール</th>
                        {roles.map((r) => (
                          <th key={r.id} className="border border-gray-200 px-3 py-3 text-center font-semibold text-gray-700 min-w-[110px]" style={{ backgroundColor: r.color ? `${r.color}20` : undefined }}>
                            {r.name}
                            {r.type === 'OTHER' && <span className="ml-1 text-[10px] text-rose-500">外部</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {apiEndpoints.map((e, i) => (
                        <tr key={e.id} className={i % 2 ? 'bg-gray-50/50' : 'bg-white'}>
                          <td className="border border-gray-200 px-4 py-2 sticky left-0 z-10" style={{ backgroundColor: i % 2 ? '#fafafa' : 'white' }}>
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${METHOD_COLOR[e.method.toUpperCase()] || 'bg-gray-100 text-gray-600'}`}>
                                {e.method.toUpperCase()}
                              </span>
                              <span className="font-mono text-xs text-gray-900 break-all">{e.path}</span>
                            </div>
                            {e.summary && <div className="text-[11px] text-gray-400 mt-0.5">{e.summary}</div>}
                          </td>
                          {roles.map((r) => {
                            const allowed = e.rolePermissions?.find((p) => p.roleId === r.id)?.allowed ?? false;
                            return (
                              <td
                                key={r.id}
                                className="border border-gray-200 px-2 py-1.5 text-center cursor-pointer hover:bg-blue-50"
                                onClick={() => toggleApiRole(e, r.id)}
                              >
                                {allowed ? (
                                  <span className="inline-flex w-5 h-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-sm font-bold" title="許可">●</span>
                                ) : (
                                  <span className="text-gray-300 text-sm" title="不許可">空</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          )}

          {/* ⑤ ステータス×ロール: テーブルごとのサブマトリクス（ステータス × ロール、operations編集） */}
          {mode === 'status-roles' && (
            <>
              {/* 凡例 */}
              <div className="flex items-center gap-3 text-xs text-gray-500">
                {STATUS_OPS.map((op) => (
                  <span key={op} className="flex items-center gap-1">
                    <span className={`inline-flex min-w-5 h-5 px-1 items-center justify-center rounded text-[11px] font-bold ${STATUS_OP_COLOR[op]}`}>{op}</span>
                  </span>
                ))}
                <span className="text-gray-400">｜ セルをクリックで許可操作を編集（対象テーブルは複数ステータス対応）</span>
              </div>

              {statusLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                </div>
              ) : statusTables.length === 0 ? (
                <Card className="bg-white border-gray-200">
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                      <GitBranch className="h-7 w-7 text-gray-400" />
                    </div>
                    <p className="text-gray-500 mb-1">テーブルがありません</p>
                    <Link href={`/dashboard/projects/${projectId}/catalog`}><Button variant="outline">データカタログへ</Button></Link>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-6">
                  {statusTables.map((t) => {
                    const statuses = [...(t.statuses || [])].sort((a, b) => a.order - b.order);
                    return (
                      <Card key={t.id} className="bg-white border-gray-200 overflow-hidden">
                        <CardContent className="p-0">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                            <Link href={`/dashboard/projects/${projectId}/catalog/${t.id}`} className="font-semibold text-gray-900 hover:text-blue-600 hover:underline">
                              {t.displayName || t.name}
                            </Link>
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={newStatus[t.id] || ''}
                                onChange={(ev) => setNewStatus((prev) => ({ ...prev, [t.id]: ev.target.value }))}
                                onKeyDown={(ev) => { if (ev.key === 'Enter') addStatus(t.id); }}
                                placeholder="新ステータス（例: 申請中）"
                                className="border border-gray-200 rounded px-2 py-1 text-xs w-full sm:w-40 focus:outline-none focus:ring-1 focus:ring-blue-400"
                              />
                              <Button size="sm" variant="outline" onClick={() => addStatus(t.id)} disabled={!(newStatus[t.id] || '').trim()}>
                                <Plus className="w-3.5 h-3.5 mr-1" />追加
                              </Button>
                            </div>
                          </div>
                          {statuses.length === 0 ? (
                            <p className="px-4 py-6 text-sm text-gray-400 text-center">ステータス未定義。右上から追加してください。</p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full border-collapse">
                                <thead>
                                  <tr className="bg-gray-50">
                                    <th className="border border-gray-200 px-4 py-2 text-left font-semibold text-gray-700 sticky left-0 bg-gray-50 z-10 min-w-[140px]">ステータス ＼ ロール</th>
                                    {roles.map((r) => (
                                      <th key={r.id} className="border border-gray-200 px-3 py-2 text-center font-semibold text-gray-700 min-w-[130px]" style={{ backgroundColor: r.color ? `${r.color}20` : undefined }}>
                                        {r.name}
                                        {r.type === 'OTHER' && <span className="ml-1 text-[10px] text-rose-500">外部</span>}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {statuses.map((s, i) => (
                                    <tr key={s.id} className={i % 2 ? 'bg-gray-50/50' : 'bg-white'}>
                                      <td className="border border-gray-200 px-4 py-2 font-medium text-gray-900 sticky left-0 z-10" style={{ backgroundColor: i % 2 ? '#fafafa' : 'white' }}>
                                        {s.label || s.value}
                                      </td>
                                      {roles.map((r) => {
                                        const ops = s.rolePermissions?.find((p) => p.roleId === r.id)?.operations ?? [];
                                        const isOpen = statusEdit?.statusId === s.id && statusEdit?.roleId === r.id;
                                        return (
                                          <td key={r.id} className="border border-gray-200 px-2 py-1.5 text-center align-top relative">
                                            <button
                                              type="button"
                                              className="w-full min-h-[28px] flex items-center justify-center flex-wrap gap-0.5 rounded hover:bg-blue-50 px-1 py-0.5"
                                              onClick={() => setStatusEdit(isOpen ? null : { statusId: s.id, roleId: r.id })}
                                            >
                                              {ops.length > 0 ? (
                                                ops.map((op) => (
                                                  <span key={op} className={`inline-flex min-w-5 h-5 px-1 items-center justify-center rounded text-[11px] font-bold ${STATUS_OP_COLOR[op] || 'bg-gray-100 text-gray-600'}`}>
                                                    {op}
                                                  </span>
                                                ))
                                              ) : (
                                                <span className="text-gray-300 text-sm">—</span>
                                              )}
                                            </button>
                                            {isOpen && (
                                              <div className="absolute z-30 mt-1 left-1/2 -translate-x-1/2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg p-2 text-left">
                                                <div className="flex items-center justify-between mb-1.5">
                                                  <span className="text-[11px] font-semibold text-gray-700">許可操作</span>
                                                  <button type="button" onClick={() => setStatusEdit(null)} className="text-gray-400 hover:text-gray-600">
                                                    <X className="w-3.5 h-3.5" />
                                                  </button>
                                                </div>
                                                <div className="space-y-1">
                                                  {STATUS_OPS.map((op) => {
                                                    const checked = ops.includes(op);
                                                    return (
                                                      <label key={op} className="flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer hover:bg-gray-50">
                                                        <input
                                                          type="checkbox"
                                                          checked={checked}
                                                          onChange={() => {
                                                            const next = checked
                                                              ? ops.filter((o) => o !== op)
                                                              : [...ops, op];
                                                            saveStatusRoleOps(s.id, r.id, next);
                                                          }}
                                                        />
                                                        <span className={`inline-flex min-w-5 h-5 px-1 items-center justify-center rounded text-[11px] font-bold ${STATUS_OP_COLOR[op]}`}>{op}</span>
                                                      </label>
                                                    );
                                                  })}
                                                </div>
                                              </div>
                                            )}
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* セル編集ダイアログ */}
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle className="text-gray-900">CRUD権限を編集</DialogTitle>
          </DialogHeader>
          {edit && (
            <div className="space-y-4 py-2">
              <div className="text-sm text-gray-600">
                <b className="text-gray-900">{edit.roleName}</b> が <b className="text-gray-900">{edit.tableName}</b> に対してできる操作:
              </div>
              <div className="grid grid-cols-2 gap-2">
                {OPS.map((op) => (
                  <label key={op} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={edit.ops[op]}
                      onChange={(e) => setEdit({ ...edit, ops: { ...edit.ops, [op]: e.target.checked } })}
                    />
                    <span className={`inline-flex w-5 h-5 items-center justify-center rounded text-[11px] font-bold ${OP_COLOR[op]}`}>{OP_LETTER[op]}</span>
                    <span className="text-sm text-gray-700">{OP_LABEL[op]}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-400">※ テーブル単位の権限として保存します（先頭カラムに紐付け）。</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)} disabled={saving}>キャンセル</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
              {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
