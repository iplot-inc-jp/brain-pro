'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTabParam } from '@/hooks/use-tab-param';
import { FlowAttachmentsGallery } from '@/components/diagram/FlowAttachmentsGallery';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  FileCode,
  Loader2,
  Eye,
  Users,
  Wand2,
  Image as ImageIcon,
  AlertCircle,
  GitBranch,
  ClipboardList,
  Grid3x3,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Save,
  Check,
  Share2,
  Table2,
  Network,
  ChevronRight,
} from 'lucide-react';
import { SwimlaneCanvas, type NodeLinksResult } from '@/components/flow-editor/SwimlaneCanvas';
import { CruoaMatrix } from '@/components/flow-editor/CruoaMatrix';
import { DfdCanvas } from '@/components/dfd/DfdCanvas';
import { DataFlowTable } from '@/components/dfd/DataFlowTable';
import { dfdApi, informationTypeApi, type DfdDiagram, type DfdNode as DfdNodeModel, type DfdFlow as DfdFlowModel, type DfdNodeKind, type InformationType, type InformationCategory } from '@/lib/dfd';
import { systemApi, type SystemMaster } from '@/lib/masters';
import {
  type RoleType,
  type ApiEndpointItem,
  listApiEndpoints,
  updateEdgeApiLinks,
} from '@/lib/api';
import type {
  FlowAnnotation,
  FlowData,
  FlowDataNode,
  FlowDataEdge,
  FlowLinkDirection,
  FlowSummary,
  Role,
} from '@/components/flow-editor/flow-types';
import { applyEdgePatch } from '@/components/flow-editor/flow-types';
import {
  deriveDefinitionFromFlow,
  hasDerivableContent,
} from '@/lib/derive-flow-definition';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { ManualButton } from '@/components/ui/manual-dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InformationTypePicker } from '@/components/masters/InformationTypePicker';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useFlowUndoRedo } from '@/hooks/use-flow-undo-redo';
import { type ImageUndoApi } from '@/hooks/use-image-op-log';
import {
  flowDefinitionApi,
  EMPTY_DEFINITION,
  type FlowDefinition,
} from '@/lib/flow-definition';
import mermaid from 'mermaid';
import { useReadOnly } from '@/components/read-only-context';
import { ExportImportButton } from '@/components/io/ExportImportButton';
import { entityJsonIo, type EntityBundle } from '@/lib/io';
import { setFlowStakeholders } from '@/lib/business-list';
import { listStakeholders, type Stakeholder } from '@/lib/stakeholders';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

// Mermaid初期化
if (typeof window !== 'undefined') {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
  });
}

type FlowTab = 'flow' | 'definition' | 'cruoa' | 'dfd';

// タブの正準キー順。?tab= の値検証と、サイドメニューのフロー子タブ生成の両方で参照する。
const FLOW_TAB_KEYS = ['flow', 'definition', 'cruoa', 'dfd'] as const;

// Mermaidから生成ダイアログの「サンプルを表示」用テンプレート。
// ロールを subgraph で表現する（parseMermaidToFlow の解析ルール: subgraph タイトル＝レーン）。
// エクスポート（exportMermaid）の往復でも破綻しない flowchart TD 記法。
const MERMAID_SAMPLE = `flowchart TD
  subgraph 営業
    A[受注受付] --> B[与信確認]
  end
  subgraph 物流
    C[出荷指示] --> D[配送手配]
  end
  B --> C`;

// ===========================================
// DFDタブ：このフローのデータフロー図（get-or-generate）＋ 図 / 一覧表 サブ切替
// ===========================================

function DfdPanel({
  flowId,
  projectId,
  flowName,
  canEdit = true,
}: {
  flowId: string;
  projectId: string;
  flowName: string;
  canEdit?: boolean;
}) {
  // 閲覧専用時に編集系コールバックを無効化（DfdCanvas は全て ?. 呼び）。
  const ro = <T,>(fn: T): T | undefined => (canEdit ? fn : undefined);
  const [diagram, setDiagram] = useState<DfdDiagram | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'diagram' | 'table'>('diagram');
  const [informationTypes, setInformationTypes] = useState<InformationType[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await dfdApi.getByFlow(flowId);
      setDiagram(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [flowId]);

  const loadInformationTypes = useCallback(async () => {
    try {
      setInformationTypes(await informationTypeApi.list(projectId));
    } catch {
      /* 情報種別の取得失敗は致命ではない */
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    void loadInformationTypes();
  }, [load, loadInformationTypes]);

  const handleRegenerate = useCallback(async () => {
    setBusy(true);
    try {
      const d = await dfdApi.generateByFlow(flowId);
      setDiagram(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }, [flowId]);

  const handleAddNode = useCallback(
    async (body: Partial<DfdNodeModel> & { kind: DfdNodeKind; label: string }) => {
      if (!diagram) return;
      await dfdApi.addNode(diagram.id, body);
      await load();
    },
    [diagram, load],
  );

  const handleUpdateNode = useCallback(
    async (id: string, patch: Partial<DfdNodeModel>) => {
      await dfdApi.updateNode(id, patch);
      await load();
    },
    [load],
  );

  const handleDeleteNode = useCallback(
    async (id: string) => {
      await dfdApi.deleteNode(id);
      await load();
    },
    [load],
  );

  const handleAddFlow = useCallback(
    async (body: {
      sourceNodeId: string;
      targetNodeId: string;
      dataItem: string;
      sourceHandle?: string | null;
      targetHandle?: string | null;
    }) => {
      if (!diagram) return;
      await dfdApi.addFlow(diagram.id, body);
      await load();
    },
    [diagram, load],
  );

  const handleUpdateFlow = useCallback(
    async (id: string, patch: Partial<DfdFlowModel>) => {
      await dfdApi.updateFlow(id, patch);
      await load();
    },
    [load],
  );

  // データフロー再ルーティング（端点ドラッグで source/target ノード・接続側を付け替え）
  // PATCH /api/dfd-flows/:id で sourceNodeId/targetNodeId/sourceHandle/targetHandle を更新 → 再取得。
  const handleReconnectFlow = useCallback(
    async (
      dfdFlowId: string,
      next: {
        sourceNodeId: string;
        targetNodeId: string;
        sourceHandle?: string | null;
        targetHandle?: string | null;
      },
    ) => {
      await dfdApi.updateFlow(dfdFlowId, {
        sourceNodeId: next.sourceNodeId,
        targetNodeId: next.targetNodeId,
        sourceHandle: next.sourceHandle ?? null,
        targetHandle: next.targetHandle ?? null,
      });
      await load();
    },
    [load],
  );

  const handleDeleteFlow = useCallback(
    async (id: string) => {
      await dfdApi.deleteFlow(id);
      await load();
    },
    [load],
  );

  const handleSavePositions = useCallback(
    async (positions: { id: string; positionX: number; positionY: number }[]) => {
      if (!diagram) return;
      // 楽観更新（再取得で fitView がリセットされ位置が飛ぶのを防ぐ）
      setDiagram((prev) =>
        prev
          ? {
              ...prev,
              nodes: prev.nodes.map((n) => {
                const p = positions.find((q) => q.id === n.id);
                return p ? { ...n, positionX: p.positionX, positionY: p.positionY } : n;
              }),
            }
          : prev,
      );
      await dfdApi.savePositions(diagram.id, positions);
    },
    [diagram],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="bg-white border-red-200">
        <CardContent className="py-8 text-center space-y-3">
          <p className="text-red-600">{error}</p>
          <Button variant="outline" onClick={() => void load()}>再読み込み</Button>
        </CardContent>
      </Card>
    );
  }

  if (!diagram) return null;

  const isEmpty = diagram.nodes.length === 0;

  return (
    <div className="space-y-3">
      {/* プロジェクトDFD ＞ フロー名 のパンくず（第1レベルへ戻る） */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-500">
        <Link
          href={`/dashboard/projects/${projectId}/dfd`}
          className="inline-flex items-center gap-1 text-blue-600 hover:underline"
        >
          <Share2 className="h-4 w-4" />
          プロジェクトDFD
        </Link>
        <ChevronRight className="h-4 w-4 text-gray-400" />
        <span className="font-medium text-gray-700">{flowName}</span>
      </nav>

      <div className="flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
        <Share2 className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
        <p className="text-sm text-indigo-800">
          このフローのノードを「処理（プロセス）」として、データの流れ（源泉/吸収＝外部実体、データストア）を
          DFD（データフロー図）で可視化します。SEC帳票風に描画し、PNG出力・データフロー一覧表に切り替えられます。
        </p>
      </div>

      {isEmpty ? (
        <Card className="bg-white border-gray-200">
          <CardContent className="py-12 text-center space-y-3">
            <p className="text-gray-500">
              このフローのDFDはまだ生成されていません。{canEdit ? '「DFDを生成」で業務フローのノードから自動生成します。' : '編集権限がないため生成できません。'}
            </p>
            {canEdit && (
              <Button onClick={handleRegenerate} disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Network className="mr-2 h-4 w-4" />}
                DFDを生成
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 図 / 一覧表 サブ切替 */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setView('diagram')}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                view === 'diagram'
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              <Network className="h-4 w-4" />図
            </button>
            <button
              type="button"
              onClick={() => setView('table')}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                view === 'table'
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              <Table2 className="h-4 w-4" />一覧表
            </button>
          </div>

          {view === 'diagram' ? (
            <div className="h-[calc(100vh-320px)] overflow-hidden rounded-lg border border-gray-200">
              <DfdCanvas
                diagram={diagram}
                informationTypes={informationTypes}
                onAddNode={ro(handleAddNode)}
                onUpdateNode={ro(handleUpdateNode)}
                onDeleteNode={ro(handleDeleteNode)}
                onAddFlow={ro(handleAddFlow)}
                onUpdateFlow={ro(handleUpdateFlow)}
                onReconnectFlow={ro(handleReconnectFlow)}
                onDeleteFlow={ro(handleDeleteFlow)}
                onSavePositions={ro(handleSavePositions)}
                onRegenerate={ro(handleRegenerate)}
              />
            </div>
          ) : (
            <DataFlowTable diagram={diagram} informationTypes={informationTypes} />
          )}
        </>
      )}
    </div>
  );
}

// ===========================================
// 個別定義タブ：このフロー1本分の業務定義を編集する
// （目的/担当/関係者/INPUT/INPUT詳細/トリガー/番号付きDO手順/OUTPUT/次工程/例外処理/頻度/システム/暗黙知メモ）
// ===========================================

// 単一行テキスト項目（input で編集）
// INPUT/OUTPUT は情報種別マスタからの選択式、次工程はロール選択式に置き換えるため、
// この汎用リストからは外し、パネル内で個別レンダリングする。
const DEF_INPUT_FIELDS: { key: keyof FlowDefinition; label: string; placeholder?: string }[] = [
  { key: 'purpose', label: '目的（なぜ必要か）' },
  { key: 'owner', label: '担当（主担当）' },
  { key: 'trigger', label: 'トリガー（いつ始まるか）' },
  { key: 'frequency', label: '頻度' },
  { key: 'system', label: '使用システム' },
];

// 次工程ロール select の「未設定」を表すセンチネル（Radix Select は空文字値を許さない）。
const NEXT_PROCESS_NONE = '__none__';

// 担当者ピッカー（portal + fixed）のサイズと、ビューポートからはみ出さないようクランプする補助。
const ASSIGNEE_POPOVER_W = 240; // w-60
const ASSIGNEE_POPOVER_H = 224; // max-h-56
function clampAssigneePopover(rect: DOMRect): { top: number; left: number } {
  const M = 8;
  const left = Math.max(M, Math.min(rect.left, window.innerWidth - ASSIGNEE_POPOVER_W - M));
  const top =
    rect.bottom + 4 + ASSIGNEE_POPOVER_H > window.innerHeight
      ? Math.max(M, rect.top - ASSIGNEE_POPOVER_H - 4)
      : rect.bottom + 4;
  return { top, left };
}

// 複数行テキスト項目（textarea で編集）
const DEF_TEXTAREA_FIELDS: { key: keyof FlowDefinition; label: string; placeholder?: string }[] = [
  { key: 'stakeholders', label: '関係者' },
  { key: 'inputDetail', label: 'INPUT詳細（セル範囲・項目など）' },
  { key: 'exceptionHandling', label: '例外処理（イレギュラー時の対応）' },
  { key: 'tacitNotes', label: '暗黙知メモ（口頭ルール・勘どころ）' },
];

function FlowDefinitionPanel({
  flowId,
  projectId,
  roles,
  nodes,
  edges,
  informationTypes,
  onCreatedInformationType,
  onCreateRole,
}: {
  flowId: string;
  projectId: string;
  /** ロール一覧（次工程＝渡し先ロールの選択肢）。取得失敗時は空配列でも動く。 */
  roles: Role[];
  /** フロー図のノード（手順・トリガー・担当・IO の自動導出元）。 */
  nodes: FlowDataNode[];
  /** フロー図のエッジ（将来の経路解析用。現状は導出に未使用）。 */
  edges: FlowDataEdge[];
  /** 情報種別マスタ（INPUT/OUTPUT の選択肢）。取得失敗時は空配列でも動く。 */
  informationTypes: InformationType[];
  /** その場で情報種別を新規作成したとき、親の一覧へ反映する。 */
  onCreatedInformationType: (created: InformationType) => void;
  /** 次工程ロールを新規作成する（POST /api/roles）。作成したロール名を返す。 */
  onCreateRole: (name: string) => Promise<string | null>;
}) {
  const [def, setDef] = useState<FlowDefinition | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // 自動保存用: 編集があったか（初期ロードと区別）＋最新 handleSave 参照（stale closure 回避）。
  const dirtyRef = useRef(false);
  const handleSaveRef = useRef<() => void | Promise<void>>(() => {});

  // 次工程（渡し先ロール）の新規追加フォーム
  const [addingRole, setAddingRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [creatingRole, setCreatingRole] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    flowDefinitionApi
      .get(flowId)
      .then((d) => {
        if (cancelled) return;
        setDef(d);
        setSteps(Array.isArray(d.doSteps) ? d.doSteps : []);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Unknown error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [flowId]);

  const setField = useCallback(
    (key: keyof FlowDefinition, value: string | null) => {
      setDef((prev) => (prev ? { ...prev, [key]: value } : prev));
      dirtyRef.current = true;
      setSavedAt(null);
    },
    [],
  );

  const moveStep = useCallback((i: number, d: -1 | 1) => {
    setSteps((s) => {
      const j = i + d;
      if (j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    dirtyRef.current = true;
    setSavedAt(null);
  }, []);

  const updateStep = useCallback((i: number, value: string) => {
    setSteps((s) => s.map((step, k) => (k === i ? value : step)));
    dirtyRef.current = true;
    setSavedAt(null);
  }, []);

  const removeStep = useCallback((i: number) => {
    setSteps((s) => s.filter((_, k) => k !== i));
    dirtyRef.current = true;
    setSavedAt(null);
  }, []);

  const addStep = useCallback(() => {
    setSteps((s) => [...s, '']);
    dirtyRef.current = true;
    setSavedAt(null);
  }, []);

  // フロー図（フローズ）から導出した業務記述書フィールド。
  // ノード/ロール/情報リンクが変わるたび再計算され、「取り込む」で業務定義へ反映できる。
  const derived = useMemo(
    () => deriveDefinitionFromFlow(nodes, edges, roles),
    [nodes, edges, roles],
  );

  // flowId ごとに「空欄のみ自動補完」を一度だけ行うためのガード。
  const autoFilledForFlow = useRef<string | null>(null);

  // 初回ロード時、フロー図に手順ノードがあれば空欄を自動補完する（手順は自動生成される）。
  // 既に値がある項目は壊さない（非破壊）。フロー未ロード時は判定を保留する。
  useEffect(() => {
    if (loading || !def) return;
    if (nodes.length === 0) return;
    if (autoFilledForFlow.current === flowId) return;
    autoFilledForFlow.current = flowId;

    let changed = false;
    if (steps.length === 0 && derived.doSteps.length > 0) {
      setSteps(derived.doSteps);
      changed = true;
    }
    const fills: Partial<FlowDefinition> = {};
    if (!(def.trigger ?? '').trim() && derived.trigger) fills.trigger = derived.trigger;
    if (!(def.owner ?? '').trim() && derived.owner) fills.owner = derived.owner;
    if (!(def.system ?? '').trim() && derived.system) fills.system = derived.system;
    if (Object.keys(fills).length > 0) {
      setDef((prev) => (prev ? { ...prev, ...fills } : prev));
      changed = true;
    }
    if (changed) {
      dirtyRef.current = true;
      setSavedAt(null);
    }
  }, [loading, def, nodes.length, steps, derived, flowId]);

  // 「フロー図から取り込む」: 手順・トリガー・担当・使用システム・INPUT/OUTPUT をフロー図で上書き。
  const handleImportFromFlow = useCallback(() => {
    const hasExisting =
      steps.length > 0 ||
      [def?.trigger, def?.owner, def?.system, def?.input, def?.output].some(
        (v) => (v ?? '').trim(),
      );
    if (
      hasExisting &&
      !window.confirm(
        'フロー図の内容で「手順・トリガー・担当・使用システム・INPUT・OUTPUT」を上書きします。よろしいですか？（個別に手入力した内容は失われます）',
      )
    ) {
      return;
    }
    setSteps(derived.doSteps);
    setDef((prev) =>
      prev
        ? {
            ...prev,
            trigger: derived.trigger ?? prev.trigger,
            owner: derived.owner ?? prev.owner,
            system: derived.system ?? prev.system,
            input: derived.input ?? prev.input,
            output: derived.output ?? prev.output,
          }
        : prev,
    );
    dirtyRef.current = true;
    setSavedAt(null);
  }, [derived, steps.length, def]);

  // 次工程ロールをその場で新規作成 → 作成したロール名を nextProcess に即セット。
  const handleCreateRole = useCallback(async () => {
    const trimmed = newRoleName.trim();
    if (!trimmed) {
      setRoleError('ロール名を入力してください');
      return;
    }
    setCreatingRole(true);
    setRoleError(null);
    try {
      const createdName = await onCreateRole(trimmed);
      if (createdName) setField('nextProcess', createdName);
      setNewRoleName('');
      setAddingRole(false);
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : 'ロールの作成に失敗しました');
    } finally {
      setCreatingRole(false);
    }
  }, [newRoleName, onCreateRole, setField]);

  const handleSave = useCallback(async () => {
    if (!def) return;
    setSaving(true);
    setSaveError(null);
    try {
      const patch: Partial<FlowDefinition> = {
        purpose: def.purpose,
        owner: def.owner,
        stakeholders: def.stakeholders,
        input: def.input,
        inputDetail: def.inputDetail,
        trigger: def.trigger,
        doSteps: steps.map((s) => s.trim()).filter((s) => s.length > 0),
        output: def.output,
        nextProcess: def.nextProcess,
        exceptionHandling: def.exceptionHandling,
        frequency: def.frequency,
        system: def.system,
        tacitNotes: def.tacitNotes,
      };
      const updated = await flowDefinitionApi.upsert(flowId, patch);
      setDef(updated);
      setSteps(Array.isArray(updated.doSteps) ? updated.doSteps : []);
      dirtyRef.current = false;
      setSavedAt(Date.now());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }, [def, steps, flowId]);

  // 最新の handleSave を ref に保持（自動保存 effect が stale な値を保存しないように）。
  handleSaveRef.current = handleSave;

  // 自動保存: 編集後 800ms 入力が止まったら保存する（手動「保存」ボタン不要）。
  // savedAt!==null（保存済み）や未編集（初期ロード）では発火しない。失敗時は手動ボタンで再保存可。
  useEffect(() => {
    if (!def || saving) return;
    if (!dirtyRef.current || savedAt !== null) return;
    const t = setTimeout(() => {
      void handleSaveRef.current();
    }, 800);
    return () => clearTimeout(t);
  }, [def, steps, savedAt, saving]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
      </div>
    );
  }

  if (loadError) {
    return (
      <Card className="bg-white border-red-200">
        <CardContent className="py-8 text-center">
          <p className="text-red-600">{loadError}</p>
        </CardContent>
      </Card>
    );
  }

  const d = def ?? { flowId, ...EMPTY_DEFINITION };

  return (
    <div className="space-y-4">
      {/* フロー図から自動生成（フローズ ↔ 業務記述書の相互反映） */}
      {nodes.length > 0 && (
        <Card className="border-blue-200 bg-blue-50/40">
          <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 text-sm font-medium text-blue-900">
                <Wand2 className="h-4 w-4 text-blue-600" />
                フロー図から取り込む
              </div>
              <p className="text-xs text-blue-700/80">
                手順 {derived.doSteps.length} 件
                {derived.trigger ? `・トリガー「${derived.trigger}」` : ''}
                {derived.owner ? `・担当「${derived.owner}」` : ''}
                {derived.system ? `・システム「${derived.system}」` : ''}
                を検出。フロー図を編集したら再取り込みで業務定義へ同期できます。
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleImportFromFlow}
              disabled={!hasDerivableContent(derived)}
              className="shrink-0 border-blue-300 bg-white text-blue-700 hover:bg-blue-100"
            >
              <Wand2 className="mr-1.5 h-4 w-4" />
              フロー図から取り込む
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 単一行テキスト項目（2カラム） */}
      <Card className="bg-white border-gray-200">
        <CardContent className="grid grid-cols-1 gap-4 py-5 md:grid-cols-2">
          {DEF_INPUT_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <label className="text-sm font-medium text-gray-700">{f.label}</label>
              <Input
                value={(d[f.key] as string | null) ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setField(f.key, e.target.value)}
                className="text-gray-900"
              />
            </div>
          ))}

          {/* INPUT（何を受け取るか）= 情報種別マスタから選択（＋その場で新規追加） */}
          <div className="space-y-1">
            <label className="flex items-center gap-1 text-sm font-medium text-gray-700">
              INPUT（何を受け取るか）
              <HelpTooltip text="情報種別マスタから選びます。一覧に無ければ「＋」でその場で追加できます。選んだ名前がそのまま保存されます。" />
            </label>
            <InformationTypePicker
              projectId={projectId}
              informationTypes={informationTypes}
              value={(d.input as string | null) ?? null}
              valueMode="name"
              onChange={(v) => setField('input', v)}
              onCreated={onCreatedInformationType}
              triggerClassName="h-9 bg-white border-gray-300 text-gray-900 text-sm"
            />
          </div>

          {/* OUTPUT（何を渡すか）= 情報種別マスタから選択（＋その場で新規追加） */}
          <div className="space-y-1">
            <label className="flex items-center gap-1 text-sm font-medium text-gray-700">
              OUTPUT（何を渡すか）
              <HelpTooltip text="情報種別マスタから選びます。一覧に無ければ「＋」でその場で追加できます。選んだ名前がそのまま保存されます。" />
            </label>
            <InformationTypePicker
              projectId={projectId}
              informationTypes={informationTypes}
              value={(d.output as string | null) ?? null}
              valueMode="name"
              onChange={(v) => setField('output', v)}
              onCreated={onCreatedInformationType}
              triggerClassName="h-9 bg-white border-gray-300 text-gray-900 text-sm"
            />
          </div>

          {/* 次工程（誰に渡すか）= ロール選択（＋その場で新規追加） */}
          <div className="space-y-1 md:col-span-2">
            <label className="flex items-center gap-1 text-sm font-medium text-gray-700">
              次工程（誰に渡すか＝ロール）
              <HelpTooltip text="この業務の OUTPUT を次に受け取るロールを選びます。一覧に無ければ「＋新規追加」で作成できます。選んだロール名が保存されます。" />
            </label>
            <div className="flex items-center gap-1">
              <Select
                value={(d.nextProcess as string | null) ?? NEXT_PROCESS_NONE}
                onValueChange={(v) =>
                  setField('nextProcess', v === NEXT_PROCESS_NONE ? null : v)
                }
              >
                <SelectTrigger className="h-9 bg-white border-gray-300 text-gray-900 text-sm">
                  <SelectValue placeholder="— 未設定 —" />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value={NEXT_PROCESS_NONE}>— 未設定 —</SelectItem>
                  {/* 一覧に無い既存値（ロール未登録の自由入力名など）も残す */}
                  {d.nextProcess &&
                    !roles.some((r) => r.name === d.nextProcess) && (
                      <SelectItem value={d.nextProcess}>{d.nextProcess}</SelectItem>
                    )}
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.name}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!addingRole && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  title="新規ロールを追加"
                  onClick={() => {
                    setRoleError(null);
                    setNewRoleName('');
                    setAddingRole(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              )}
            </div>
            {addingRole && (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  placeholder="新しいロール名（例: 経理担当）"
                  className="h-9 text-gray-900"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleCreateRole();
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleCreateRole()}
                  disabled={creatingRole}
                >
                  {creatingRole && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  追加して選択
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAddingRole(false);
                    setRoleError(null);
                  }}
                  disabled={creatingRole}
                >
                  キャンセル
                </Button>
              </div>
            )}
            {roleError && <p className="text-sm text-red-600">{roleError}</p>}
          </div>
        </CardContent>
      </Card>

      {/* 番号付き DO 手順 */}
      <Card className="bg-white border-gray-200">
        <CardContent className="space-y-3 py-5">
          <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
            DO（手順を番号順に）
            <HelpTooltip text="この業務で「実際に何をするか」を手順ごとに1行ずつ。↑↓で順序を入れ替え、不要な行は削除できます。" />
          </div>
          {steps.length === 0 ? (
            <p className="text-sm text-gray-400">手順がありません。「手順を追加」で1行目を作成してください。</p>
          ) : (
            <div className="space-y-2">
              {steps.map((step, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-right text-sm font-medium text-gray-500">
                    {i + 1}.
                  </span>
                  <Input
                    value={step}
                    onChange={(e) => updateStep(i, e.target.value)}
                    placeholder={`手順 ${i + 1}`}
                    className="text-gray-900"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveStep(i, -1)}
                    disabled={i === 0}
                    className="text-gray-500"
                    aria-label="上へ"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveStep(i, 1)}
                    disabled={i === steps.length - 1}
                    className="text-gray-500"
                    aria-label="下へ"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeStep(i)}
                    className="text-red-500 hover:text-red-600"
                    aria-label="削除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <Button type="button" variant="outline" size="sm" onClick={addStep} className="text-gray-600">
            <Plus className="mr-1.5 h-4 w-4" />
            手順を追加
          </Button>
        </CardContent>
      </Card>

      {/* 複数行テキスト項目 */}
      <Card className="bg-white border-gray-200">
        <CardContent className="grid grid-cols-1 gap-4 py-5 md:grid-cols-2">
          {DEF_TEXTAREA_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <label className="text-sm font-medium text-gray-700">{f.label}</label>
              <Textarea
                value={(d[f.key] as string | null) ?? ''}
                placeholder={f.placeholder}
                rows={3}
                onChange={(e) => setField(f.key, e.target.value)}
                className="text-gray-900"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 自動保存ステータス（編集すると自動で保存される。手動保存は不要。失敗時のみ「再保存」） */}
      <div className="flex items-center gap-3 text-sm">
        {saving ? (
          <span className="inline-flex items-center gap-1 text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            保存中…
          </span>
        ) : saveError ? (
          <>
            <span className="inline-flex items-center gap-1 text-red-600">
              <AlertCircle className="h-4 w-4" />
              {saveError}
            </span>
            <Button size="sm" variant="outline" onClick={handleSave}>
              再保存
            </Button>
          </>
        ) : savedAt ? (
          <span className="inline-flex items-center gap-1 text-emerald-600">
            <Check className="h-4 w-4" />
            自動保存済み
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-gray-400">
            <Save className="h-4 w-4" />
            変更すると自動で保存されます
          </span>
        )}
      </div>
    </div>
  );
}

export default function ProjectFlowDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const flowId = params.flowId as string;
  const { canEdit } = useReadOnly();
  // 閲覧専用時に編集系コールバックを無効化するためのヘルパー。
  // SwimlaneCanvas/DfdCanvas は全コールバックを ?. で呼ぶため、undefined を渡せば編集不可になる。
  const ro = <T,>(fn: T): T | undefined => (canEdit ? fn : undefined);

  // フロー図 / 業務定義 / 情報の地図(CRUOA) / DFD のタブ。
  // URL の ?tab= と双方向同期し、左サイドメニューのフロー子タブ（メニューダウン）から
  // 各タブへ直接 deep-link できるようにする（?tab=definition / cruoa / dfd）。
  const [tabParam, setActiveTab] = useTabParam('flow');
  const activeTab: FlowTab = (FLOW_TAB_KEYS as readonly string[]).includes(tabParam)
    ? (tabParam as FlowTab)
    : 'flow';

  // このフローに紐づく画像・ファイルのギャラリー（フロー図タブのボタンで開く）。
  const [galleryOpen, setGalleryOpen] = useState(false);

  const [flowData, setFlowData] = useState<FlowData | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [otherFlows, setOtherFlows] = useState<FlowSummary[]>([]);
  const [informationTypes, setInformationTypes] = useState<InformationType[]>([]);
  // システムマスタ（ロールの type==='SYSTEM' のとき紐づけ先選択肢）
  const [systems, setSystems] = useState<SystemMaster[]>([]);
  // 注釈（付箋・コメント）。flowData.nodes/edges とは別系統で扱う（整形/転置/Undo-Redo 対象外）。
  const [annotations, setAnnotations] = useState<FlowAnnotation[]>([]);
  // プロジェクトの API エンドポイント一覧（矢印×API 紐づけの選択肢。コードカタログで抽出済み）。
  const [apiEndpoints, setApiEndpoints] = useState<ApiEndpointItem[]>([]);
  // フロー単位の担当者（FlowStakeholder の多対多）用のステークホルダー一覧。
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  // 担当者ピッカー（ポップオーバ）の開閉と表示座標（portal + fixed でヘッダーのクリップ回避）。
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [assigneePickerPos, setAssigneePickerPos] = useState<{ top: number; left: number } | null>(null);
  // 担当者保存中フラグ（連打レース防止＝replace-all の取りこぼし防止）。
  const [assigneeSaving, setAssigneeSaving] = useState(false);
  // 担当者保存エラー（ページ全体の error とは分離。失敗してもエディタは落とさず、チップ脇に小さく表示）。
  const [assigneeError, setAssigneeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flowHistory, setFlowHistory] = useState<string[]>([]);
  const [mermaidCode, setMermaidCode] = useState<string | null>(null);
  const [showMermaid, setShowMermaid] = useState(false);

  // 表示ロール選択（フローごとに localStorage 永続化）
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[] | null>(null);
  const [showRolePanel, setShowRolePanel] = useState(false);
  const rolePanelRef = useRef<HTMLDivElement | null>(null);

  // ロールのチェックを外したとき、そのロールに属するノードを再割当するダイアログ
  const [reassign, setReassign] = useState<{
    roleId: string;
    nodes: { id: string; label: string; targetRoleId: string }[];
  } | null>(null);
  const [reassignBusy, setReassignBusy] = useState(false);

  // Mermaid から生成ダイアログ
  const [showMermaidImport, setShowMermaidImport] = useState(false);
  const [mermaidImportText, setMermaidImportText] = useState('');
  const [mermaidImporting, setMermaidImporting] = useState(false);
  const [mermaidImportError, setMermaidImportError] = useState<string | null>(null);

  const howToRef = useRef<HTMLDivElement | null>(null);

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem('accessToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  // ロール一覧取得（フロー途中でのロール追加後の再取得でも再利用する）
  const fetchRoles = useCallback(async () => {
    const headers = getHeaders();
    const rolesRes = await fetch(`${API_URL}/api/roles/project/${projectId}`, { headers });
    if (rolesRes.ok) {
      const rolesData = await rolesRes.json();
      setRoles(rolesData);
    }
  }, [projectId, getHeaders]);

  // 注釈（付箋・コメント）一覧を取得（GET /business-flows/:flowId/annotations）。
  // flowData.nodes/edges とは別系統。フローデータ取得・フロー切替時に併せて読む。
  const fetchAnnotations = useCallback(async (id: string) => {
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/business-flows/${id}/annotations`, { headers });
      if (!res.ok) return;
      const data = (await res.json()) as FlowAnnotation[];
      setAnnotations(Array.isArray(data) ? data : []);
    } catch (err) {
      // 注釈の取得失敗はフロー描画の致命ではない（付箋が出ないだけ）
      console.error('Failed to fetch annotations:', err);
    }
  }, [getHeaders]);

  // フローデータを取得
  // silent=true（Undo/Redo の restore 直後の再取得）では全画面ローディングを出さず、
  // 図がちらつかないようにする（キャンバスは前回状態を保ったまま差し替わる）。
  const fetchFlowData = useCallback(async (id: string, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);

    try {
      const headers = getHeaders();

      // フローデータ取得
      const flowRes = await fetch(`${API_URL}/api/business-flows/${id}`, { headers });
      if (!flowRes.ok) throw new Error('Failed to fetch flow data');
      const flow = await flowRes.json();

      // ロール取得（関数化した fetchRoles を再利用）
      await fetchRoles();
      // 注釈（付箋・コメント）も併せて取得（別系統）
      await fetchAnnotations(id);

      setFlowData(flow);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [getHeaders, fetchRoles, fetchAnnotations]);

  // 担当者ピッカー用のステークホルダー一覧取得（プロジェクト全体）。
  const fetchStakeholders = useCallback(async () => {
    try {
      setStakeholders(await listStakeholders(projectId));
    } catch {
      /* 担当者一覧の取得失敗は致命ではない（ピッカーが空になるだけ） */
    }
  }, [projectId]);

  // stakeholderId → ステークホルダー（チップ／ピッカーの名前解決）。
  const stakeholderById = useMemo(
    () => new Map(stakeholders.map((s) => [s.id, s])),
    [stakeholders],
  );

  // フロー担当者トグル（楽観更新 → setFlowStakeholders で保存、失敗時はフロー再取得で巻き戻す）。
  const toggleAssignee = useCallback(
    async (stakeholderId: string) => {
      if (!flowData) return;
      // 保存中の連打は無視（replace-all の取りこぼし防止）。
      if (assigneeSaving) return;
      setAssigneeSaving(true);
      // 直前の担当者保存エラーはクリア（再操作のたびにリセット）。
      setAssigneeError(null);
      const cur = (flowData.assignees ?? []).map((a) => a.stakeholderId);
      const nextIds = cur.includes(stakeholderId)
        ? cur.filter((x) => x !== stakeholderId)
        : [...cur, stakeholderId];
      // 楽観更新。既存担当者のサーバ提供名は温存し、未取得の stakeholders で「（不明）」化させない。
      setFlowData((prev) => {
        if (!prev) return prev;
        const prevNames = new Map((prev.assignees ?? []).map((a) => [a.stakeholderId, a.name]));
        return {
          ...prev,
          assignees: nextIds.map((id, i) => ({
            stakeholderId: id,
            name: prevNames.get(id) || stakeholderById.get(id)?.name || '',
            order: i,
          })),
        };
      });
      try {
        const { assignees } = await setFlowStakeholders(flowData.id, nextIds);
        setFlowData((prev) => (prev ? { ...prev, assignees } : prev));
      } catch {
        // ページ全体の error には触れない（エディタを落とさない）。専用 state でチップ脇に表示。
        setAssigneeError('担当者の保存に失敗しました');
        await fetchFlowData(flowData.id, true);
      } finally {
        setAssigneeSaving(false);
      }
    },
    [flowData, assigneeSaving, stakeholderById, fetchFlowData],
  );

  // Mermaid出力取得
  const fetchMermaid = useCallback(async () => {
    if (!flowData) return;

    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/business-flows/${flowData.id}/mermaid`, { headers });
      if (res.ok) {
        const data = await res.json();
        setMermaidCode(data.mermaid);
        setShowMermaid(true);
      }
    } catch (err) {
      console.error('Failed to fetch mermaid:', err);
    }
  }, [flowData, getHeaders]);

  // プロジェクトの他フロー一覧（連携先フローピッカー用）
  const fetchOtherFlows = useCallback(async () => {
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/business-flows/project/${projectId}/all`, { headers });
      if (!res.ok) return;
      const data = (await res.json()) as FlowSummary[];
      setOtherFlows(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch project flows:', err);
    }
  }, [projectId, getHeaders]);

  // プロジェクトの情報種別マスタ（ノードINPUT/OUTPUTの多選択用）
  const fetchInformationTypes = useCallback(async () => {
    try {
      setInformationTypes(await informationTypeApi.list(projectId));
    } catch {
      /* 情報種別の取得失敗は致命ではない（多選択が空になるだけ） */
    }
  }, [projectId]);

  // プロジェクトのシステムマスタ（ロール編集の type==='SYSTEM' 紐づけ用）
  const fetchSystems = useCallback(async () => {
    try {
      setSystems(await systemApi.list(projectId));
    } catch {
      /* システムの取得失敗は致命ではない（system セレクトが空になるだけ） */
    }
  }, [projectId]);

  // プロジェクトの API エンドポイント一覧（矢印×API 紐づけセクションの選択肢）
  const fetchApiEndpoints = useCallback(async () => {
    try {
      setApiEndpoints(await listApiEndpoints(projectId));
    } catch {
      /* API一覧の取得失敗は致命ではない（API セクションの選択肢が空になるだけ） */
    }
  }, [projectId]);

  // 初期読み込み
  useEffect(() => {
    if (flowId) {
      fetchFlowData(flowId);
      setFlowHistory([flowId]);
    }
  }, [flowId, fetchFlowData]);

  useEffect(() => {
    if (projectId) fetchOtherFlows();
  }, [projectId, fetchOtherFlows]);

  useEffect(() => {
    if (projectId) fetchInformationTypes();
  }, [projectId, fetchInformationTypes]);

  useEffect(() => {
    if (projectId) fetchSystems();
  }, [projectId, fetchSystems]);

  useEffect(() => {
    if (projectId) fetchApiEndpoints();
  }, [projectId, fetchApiEndpoints]);

  useEffect(() => {
    if (projectId) fetchStakeholders();
  }, [projectId, fetchStakeholders]);

  // フロー切替（ドリルダウン／戻る）時に担当者ピッカーを閉じる（旧座標・別フローの誤表示防止）。
  useEffect(() => {
    setAssigneePickerOpen(false);
    setAssigneePickerPos(null);
  }, [flowData?.id]);

  // ピッカー表示中はスクロール／リサイズで閉じる（fixed の座標ずれ・はみ出し防止）。
  useEffect(() => {
    if (!assigneePickerOpen) return;
    const close = () => setAssigneePickerOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [assigneePickerOpen]);

  // 子フローへナビゲート
  const handleNodeDoubleClick = useCallback(
    (nodeId: string, childFlowId?: string) => {
      if (childFlowId) {
        setFlowHistory((prev) => [...prev, childFlowId]);
        fetchFlowData(childFlowId);
      }
    },
    [fetchFlowData]
  );

  // 親フローへ戻る
  const handleBack = useCallback(() => {
    if (flowHistory.length > 1) {
      const newHistory = [...flowHistory];
      newHistory.pop();
      const parentId = newHistory[newHistory.length - 1];
      setFlowHistory(newHistory);
      fetchFlowData(parentId);
    }
  }, [flowHistory, fetchFlowData]);

  // フロー情報の更新
  const handleFlowUpdate = useCallback(
    async (id: string, name: string, description?: string) => {
      try {
        const headers = getHeaders();
        const res = await fetch(`${API_URL}/api/business-flows/${id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ name, description }),
        });

        if (!res.ok) throw new Error('Failed to update flow');
        fetchFlowData(id);
      } catch (err) {
        console.error('Failed to update flow:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    },
    [fetchFlowData, getHeaders]
  );

  // エッジラベル更新
  const handleEdgeLabelUpdate = useCallback(
    async (edgeId: string, label: string) => {
      if (!flowData) return;
      try {
        const headers = getHeaders();
        const res = await fetch(`${API_URL}/api/business-flows/${flowData.id}/edges/${edgeId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ label }),
        });

        if (!res.ok) throw new Error('Failed to update edge label');
        // 楽観更新（全体再取得＝キャンバス全再描画を避ける）。
        setFlowData((prev) =>
          prev
            ? {
                ...prev,
                edges: prev.edges.map((e) =>
                  e.id === edgeId ? applyEdgePatch(e, { label }) : e
                ),
              }
            : prev
        );
      } catch (err) {
        console.error('Failed to update edge label:', err);
        if (flowData) fetchFlowData(flowData.id, true);
      }
    },
    [flowData, fetchFlowData, getHeaders]
  );

  // エッジ更新（運ぶ情報種別 informationTypeId / ラベル）
  // PUT /api/business-flows/:flowId/edges/:edgeId に変化したフィールドのみ送る。
  // informationTypeId は null で「未設定」を表す（undefined のキーは送らない）。
  // 情報種別を設定したら、source ノードの OUTPUT・target ノードの INPUT として
  // 情報種別リンクへ非破壊マージする（既にあれば何もしない）。
  const handleEdgeUpdate = useCallback(
    async (
      edgeId: string,
      patch: {
        informationTypeId?: string | null;
        label?: string;
        pathStyle?: string | null;
        labelT?: number | null;
        infoT?: number | null;
      }
    ) => {
      if (!flowData) return;
      try {
        const headers = getHeaders();
        const res = await fetch(`${API_URL}/api/business-flows/${flowData.id}/edges/${edgeId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error('Failed to update edge');

        // 情報種別を設定した場合のみ、source/target ノードの INPUT/OUTPUT へ非破壊同期。
        // ノードの現在の informationLinks（フロー詳細に含まれる）を読み、無ければ追加して
        // replace-all（PUT .../information-links）でマージ保存する。既にあれば送らない。
        const infoId = patch.informationTypeId;
        if (infoId) {
          const edge = flowData.edges.find((e) => e.id === edgeId);
          if (edge) {
            const ensure = async (
              nodeId: string,
              direction: FlowLinkDirection
            ) => {
              const node = flowData.nodes.find((n) => n.id === nodeId);
              if (!node) return;
              const existing = node.informationLinks ?? [];
              const has = existing.some(
                (l) => l.informationTypeId === infoId && l.direction === direction
              );
              if (has) return;
              // 既存リンクを保ったまま、無い方向に当該情報種別を末尾追加して replace-all 保存。
              const links = [
                ...existing.map((l) => ({
                  informationTypeId: l.informationTypeId,
                  direction: l.direction,
                  order: l.order,
                })),
                {
                  informationTypeId: infoId,
                  direction,
                  order: existing.filter((l) => l.direction === direction).length,
                },
              ];
              const r = await fetch(
                `${API_URL}/api/business-flows/${flowData.id}/nodes/${nodeId}/information-links`,
                { method: 'PUT', headers, body: JSON.stringify({ links }) }
              );
              if (!r.ok) throw new Error('Failed to sync node information link');
            };
            await Promise.all([
              ensure(edge.sourceNodeId, 'OUTPUT'),
              ensure(edge.targetNodeId, 'INPUT'),
            ]);
          }
          // 情報種別を「実値で設定」した時のみ、名前解決＋ノード IN/OUT 反映のため再取得する。
          fetchFlowData(flowData.id);
          return;
        }

        // それ以外（pathStyle 曲線↔直線 / labelT・infoT のドラッグ / label / 情報種別クリア）は
        // ローカル楽観更新で軽くする（全体再取得＝キャンバス全再描画を避ける）。
        setFlowData((prev) =>
          prev
            ? {
                ...prev,
                edges: prev.edges.map((e) =>
                  e.id === edgeId ? applyEdgePatch(e, patch) : e
                ),
              }
            : prev
        );
      } catch (err) {
        console.error('Failed to update edge:', err);
        if (flowData) fetchFlowData(flowData.id, true);
      }
    },
    [flowData, fetchFlowData, getHeaders]
  );

  // 矢印×API 紐づけの全置換保存（PUT /flow-edges/:id/api-links）。
  // 成功時はレスポンスのリンク一覧で flowData.edges[].apiLinks を楽観更新し、
  // 再取得のちらつき（キャンバス全体の再描画）を避ける。失敗時はサーバ状態へ戻す。
  const handleSaveEdgeApiLinks = useCallback(
    async (edgeId: string, apiEndpointIds: string[]) => {
      try {
        const links = await updateEdgeApiLinks(edgeId, apiEndpointIds);
        setFlowData((prev) =>
          prev
            ? {
                ...prev,
                edges: prev.edges.map((e) =>
                  e.id === edgeId ? { ...e, apiLinks: links } : e
                ),
              }
            : prev
        );
      } catch (err) {
        console.error('Failed to update edge api links:', err);
        if (flowData) fetchFlowData(flowData.id, true);
      }
    },
    [flowData, fetchFlowData]
  );

  // ノードロール更新
  const handleNodeRoleUpdate = useCallback(
    async (nodeId: string, roleId: string) => {
      if (!flowData) return;
      try {
        const headers = getHeaders();
        const res = await fetch(`${API_URL}/api/business-flows/${flowData.id}/nodes/${nodeId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ roleId }),
        });

        if (!res.ok) throw new Error('Failed to update node role');
        fetchFlowData(flowData.id);
      } catch (err) {
        console.error('Failed to update node role:', err);
      }
    },
    [flowData, fetchFlowData, getHeaders]
  );

  // ノード更新（ラベル/種別/ロール/自由配置位置/並び順/メタデータ）
  // SwimlaneCanvas が右サイドバー保存・ドラッグ完了（positionX/positionY/roleId 変更）で呼ぶ
  const handleNodeUpdate = useCallback(
    async (
      nodeId: string,
      patch: {
        label?: string;
        type?: string;
        roleId?: string;
        order?: number;
        positionX?: number;
        positionY?: number;
        /** マウスリサイズ後の描画幅/高さ（PUT node で永続化）。 */
        width?: number;
        height?: number;
        processingTime?: string | null;
        handledCount?: string | null;
        supplement?: string | null;
        metadata?: Record<string, unknown>;
      }
    ) => {
      if (!flowData) return;
      try {
        const headers = getHeaders();
        const res = await fetch(`${API_URL}/api/business-flows/${flowData.id}/nodes/${nodeId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(patch),
        });

        if (!res.ok) throw new Error('Failed to update node');
        // 移動/リサイズ/レーン変更だけのパッチは、サーバ再取得せずローカルへ楽観反映する。
        // （毎回フル再取得するとキャンバスが丸ごと再構築されて一瞬チラつく。
        //   複数選択ドラッグではノード数ぶん再取得が走っていた）
        const MOVE_KEYS = new Set(['positionX', 'positionY', 'roleId', 'width', 'height']);
        const isMoveOnly = Object.keys(patch).every((k) => MOVE_KEYS.has(k));
        if (isMoveOnly) {
          setFlowData((prev) =>
            prev
              ? {
                  ...prev,
                  nodes: prev.nodes.map((n) =>
                    n.id === nodeId
                      ? {
                          ...n,
                          ...(patch.positionX !== undefined ? { positionX: patch.positionX } : {}),
                          ...(patch.positionY !== undefined ? { positionY: patch.positionY } : {}),
                          ...(patch.width !== undefined ? { width: patch.width } : {}),
                          ...(patch.height !== undefined ? { height: patch.height } : {}),
                          ...(patch.roleId !== undefined
                            ? {
                                roleId: patch.roleId,
                                role: roles.find((r) => r.id === patch.roleId) ?? n.role,
                              }
                            : {}),
                        }
                      : n
                  ),
                }
              : prev
          );
        } else {
          // ラベル/種別/メタデータ等の構造変更は従来どおり再取得で整合させる
          fetchFlowData(flowData.id);
        }
      } catch (err) {
        console.error('Failed to update node:', err);
      }
    },
    [flowData, fetchFlowData, getHeaders, roles]
  );

  // 「整形」: 全ノードの位置/ロール/順序を一括保存（PUT /:flowId/nodes/positions）→ 再取得。
  // SwimlaneCanvas が computeFlowLayout の綺麗な座標を渡してくる（ぐちゃぐちゃ修正の安全網）。
  const handleTidyNodes = useCallback(
    async (
      positions: Array<{
        id: string;
        positionX: number;
        positionY: number;
        roleId?: string | null;
        order?: number;
      }>,
      // 整形が算出した最近接サイド接続ハンドル（任意）。位置保存と同一リクエストで送る。
      edges?: Array<{
        id: string;
        sourceHandle?: string | null;
        targetHandle?: string | null;
      }>
    ) => {
      if (!flowData) return;
      try {
        const headers = getHeaders();
        const res = await fetch(
          `${API_URL}/api/business-flows/${flowData.id}/nodes/positions`,
          {
            method: 'PUT',
            headers,
            body: JSON.stringify(
              edges && edges.length > 0 ? { positions, edges } : { positions }
            ),
          }
        );
        if (!res.ok) throw new Error('Failed to tidy node positions');
        // 再取得完了まで await して返す Promise に含める。
        // SwimlaneCanvas 側はこの Promise の解決を「flowData の座標が新レイアウトへ
        // 入れ替わった」合図として整形/縦横ボタンの連打ガードに使う（解決前に次の
        // 縦横切替が走ると、旧座標のノードと移動済みの注釈を突き合わせてしまう）。
        await fetchFlowData(flowData.id);
      } catch (err) {
        console.error('Failed to tidy node positions:', err);
      }
    },
    [flowData, fetchFlowData, getHeaders]
  );

  // ノード作成（構造ベース：位置はサーバ側0固定、描画は自動レイアウト）
  const handleNodeCreate = useCallback(
    async (input: { type: string; roleId?: string; afterNodeId?: string }) => {
      if (!flowData) return;
      const { type, roleId } = input;
      try {
        const headers = getHeaders();
        const res = await fetch(`${API_URL}/api/business-flows/${flowData.id}/nodes`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            type,
            label: type === 'DECISION' ? '条件分岐' : type === 'SYSTEM_INTEGRATION' ? 'システム連携' : '新規処理',
            positionX: 0,
            positionY: 0,
            ...(roleId ? { roleId } : {}),
          }),
        });

        if (!res.ok) throw new Error('Failed to create node');
        fetchFlowData(flowData.id);
      } catch (err) {
        console.error('Failed to create node:', err);
      }
    },
    [flowData, fetchFlowData, getHeaders]
  );

  // ノード削除
  const handleNodeDelete = useCallback(
    async (nodeId: string) => {
      if (!flowData) return;
      try {
        const headers = getHeaders();
        const res = await fetch(`${API_URL}/api/business-flows/${flowData.id}/nodes/${nodeId}`, {
          method: 'DELETE',
          headers,
        });

        if (!res.ok) throw new Error('Failed to delete node');
        fetchFlowData(flowData.id);
      } catch (err) {
        console.error('Failed to delete node:', err);
      }
    },
    [flowData, fetchFlowData, getHeaders]
  );

  // エッジ作成（ドラッグで使った接続側ハンドル sourceHandle/targetHandle も保存）
  const handleEdgeCreate = useCallback(
    async (
      sourceNodeId: string,
      targetNodeId: string,
      handles?: { sourceHandle?: string | null; targetHandle?: string | null }
    ) => {
      if (!flowData) return;
      try {
        const headers = getHeaders();
        const res = await fetch(`${API_URL}/api/business-flows/${flowData.id}/edges`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            sourceNodeId,
            targetNodeId,
            ...(handles?.sourceHandle ? { sourceHandle: handles.sourceHandle } : {}),
            ...(handles?.targetHandle ? { targetHandle: handles.targetHandle } : {}),
          }),
        });

        if (!res.ok) throw new Error('Failed to create edge');
        // 楽観更新: サーバが返した新エッジをローカルへ追加（全体再取得＝キャンバス全再描画を避ける）。
        const created = await res.json().catch(() => null);
        if (created?.id) {
          setFlowData((prev) =>
            prev
              ? {
                  ...prev,
                  edges: [
                    ...prev.edges,
                    {
                      id: created.id,
                      sourceNodeId,
                      targetNodeId,
                      sourceHandle: created.sourceHandle ?? handles?.sourceHandle ?? null,
                      targetHandle: created.targetHandle ?? handles?.targetHandle ?? null,
                      label: created.label ?? undefined,
                      condition: created.condition ?? undefined,
                      informationTypeId: created.informationTypeId ?? null,
                      informationType: created.informationType ?? null,
                      pathStyle: created.pathStyle ?? null,
                      labelT: created.labelT ?? null,
                      infoT: created.infoT ?? null,
                      apiLinks: created.apiLinks ?? [],
                    },
                  ],
                }
              : prev
          );
        } else {
          // レスポンスが想定外なら従来どおり再取得でフォールバック。
          fetchFlowData(flowData.id, true);
        }
      } catch (err) {
        console.error('Failed to create edge:', err);
        if (flowData) fetchFlowData(flowData.id, true);
      }
    },
    [flowData, fetchFlowData, getHeaders]
  );

  // ハンドルから空き場所にドロップ → ノード自動生成＋接続（Whimsical風） ②
  // 既存エンドポイントのみ再利用: POST /:flowId/nodes（位置・ロール指定）で新ノードを作り、
  // POST /:flowId/edges（最近接サイドハンドル付き）で 開始ノード → 新ノード を接続する。
  // schema/endpoint は不変。
  const handleCreateConnectedNode = useCallback(
    async (input: {
      sourceNodeId: string;
      sourceHandle: string;
      targetHandle: string;
      position: { x: number; y: number };
      roleId?: string;
    }) => {
      if (!flowData) return;
      try {
        const headers = getHeaders();
        // 1) 新ノード（PROCESS）をドロップ座標・開始ノードと同じロールで生成
        const createRes = await fetch(`${API_URL}/api/business-flows/${flowData.id}/nodes`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            type: 'PROCESS',
            label: '新規処理',
            positionX: input.position.x,
            positionY: input.position.y,
            ...(input.roleId ? { roleId: input.roleId } : {}),
          }),
        });
        if (!createRes.ok) throw new Error('Failed to create node');
        const created = await createRes.json();
        const newNodeId: string | undefined = created?.id;
        if (!newNodeId) throw new Error('Created node has no id');

        // 2) 開始ノード → 新ノード を接続（ドラッグで使った開始ハンドル側を保存）
        const edgeRes = await fetch(`${API_URL}/api/business-flows/${flowData.id}/edges`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            sourceNodeId: input.sourceNodeId,
            targetNodeId: newNodeId,
            sourceHandle: input.sourceHandle,
            targetHandle: input.targetHandle,
          }),
        });
        if (!edgeRes.ok) throw new Error('Failed to connect to new node');

        fetchFlowData(flowData.id);
      } catch (err) {
        console.error('Failed to create connected node:', err);
      }
    },
    [flowData, fetchFlowData, getHeaders]
  );

  // エッジ再ルーティング（端点ドラッグで source/target ノード・接続側を付け替え）
  // PATCH /api/business-flows/:flowId/edges/:edgeId で sourceNodeId/targetNodeId/
  // sourceHandle/targetHandle を更新 → 再取得。
  const handleReconnectEdge = useCallback(
    async (
      edgeId: string,
      next: {
        sourceNodeId: string;
        targetNodeId: string;
        sourceHandle?: string | null;
        targetHandle?: string | null;
      }
    ) => {
      if (!flowData) return;
      try {
        const headers = getHeaders();
        const res = await fetch(`${API_URL}/api/business-flows/${flowData.id}/edges/${edgeId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            sourceNodeId: next.sourceNodeId,
            targetNodeId: next.targetNodeId,
            sourceHandle: next.sourceHandle ?? null,
            targetHandle: next.targetHandle ?? null,
          }),
        });

        if (!res.ok) throw new Error('Failed to reconnect edge');
        // 楽観更新: 端点（source/target/接続側）をローカルに反映（全体再取得を避ける）。
        setFlowData((prev) =>
          prev
            ? {
                ...prev,
                edges: prev.edges.map((e) =>
                  e.id === edgeId
                    ? {
                        ...e,
                        sourceNodeId: next.sourceNodeId,
                        targetNodeId: next.targetNodeId,
                        sourceHandle: next.sourceHandle ?? null,
                        targetHandle: next.targetHandle ?? null,
                      }
                    : e
                ),
              }
            : prev
        );
      } catch (err) {
        console.error('Failed to reconnect edge:', err);
        if (flowData) fetchFlowData(flowData.id, true);
      }
    },
    [flowData, fetchFlowData, getHeaders]
  );

  // エッジ削除（ノード位置を維持するためローカルで更新）
  const handleEdgeDelete = useCallback(
    async (edgeId: string) => {
      if (!flowData) return;
      try {
        const headers = getHeaders();
        const res = await fetch(`${API_URL}/api/business-flows/${flowData.id}/edges/${edgeId}`, {
          method: 'DELETE',
          headers,
        });

        if (!res.ok) throw new Error('Failed to delete edge');
        
        // ノード位置を維持するためローカルでエッジを削除
        setFlowData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            edges: prev.edges.filter((e) => e.id !== edgeId),
          };
        });
      } catch (err) {
        console.error('Failed to delete edge:', err);
      }
    },
    [flowData, getHeaders]
  );

  // 接続線（エッジ）の途中に PROCESS ノードを挿入する。
  // source→target の既存エッジを、source→新ノード→target に繋ぎ替える。
  // - 新ノードの roleId は source ノードのロールを引き継ぐ
  // - order は source.order と target.order の中点（既存の order スキームに従う）
  // - 位置は source/target の中点（自由配置）
  // 既存の node-create(POST /nodes) / connect(POST /edges) / delete-edge(DELETE /edges/:id)
  // をそのまま再利用し、新ノードの order/position は updateNode(PUT /nodes/:id) で保存する。
  const handleInsertNodeOnEdge = useCallback(
    async (edgeId: string) => {
      if (!flowData) return;
      const edge = flowData.edges.find((e) => e.id === edgeId);
      if (!edge) return;
      const source = flowData.nodes.find((n) => n.id === edge.sourceNodeId);
      const target = flowData.nodes.find((n) => n.id === edge.targetNodeId);
      if (!source || !target) return;

      try {
        const headers = getHeaders();

        // order の中点（既存スキーム: order 昇順がタイムライン軸）
        const sourceOrder = source.order ?? 0;
        const targetOrder = target.order ?? sourceOrder + 2;
        const midOrder = (sourceOrder + targetOrder) / 2;

        // 各ノードの中心座標（左上座標 + 半サイズ）。最近接サイド判定に使う。
        // NODE_W/NODE_H は SwimlaneCanvas の描画サイズと揃える（156×52）。
        const NODE_W = 156;
        const NODE_H = 52;
        const centerOf = (n: { positionX?: number; positionY?: number }) => ({
          x: (n.positionX ?? 0) + NODE_W / 2,
          y: (n.positionY ?? 0) + NODE_H / 2,
        });
        const sCenter = centerOf(source);
        const tCenter = centerOf(target);
        // 新ノード N の中心は A,B 中心の中間（同じレーン/行に収まるよう中点に置く）。
        const nCenter = {
          x: (sCenter.x + tCenter.x) / 2,
          y: (sCenter.y + tCenter.y) / 2,
        };
        // 新ノードの保存座標（左上基準）。
        const midX = nCenter.x - NODE_W / 2;
        const midY = nCenter.y - NODE_H / 2;

        // 2 ノード中心から最近接サイドのハンドルを決める（computeFlowLayout と同等）。
        // |dx|>=|dy| なら横優先 source=右(dx>0)/左、target はその逆。
        // それ以外は縦優先 source=下(dy>0)/上、target は逆。
        const opposite: Record<string, string> = {
          top: 'bottom',
          bottom: 'top',
          left: 'right',
          right: 'left',
        };
        const nearestHandles = (
          a: { x: number; y: number },
          b: { x: number; y: number },
        ): { sourceHandle: string; targetHandle: string } => {
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const sourceHandle =
            Math.abs(dx) >= Math.abs(dy)
              ? dx > 0
                ? 'right'
                : 'left'
              : dy > 0
              ? 'bottom'
              : 'top';
          return { sourceHandle, targetHandle: opposite[sourceHandle] };
        };
        const h1 = nearestHandles(sCenter, nCenter); // A → N
        const h2 = nearestHandles(nCenter, tCenter); // N → B

        // 1) 新しい PROCESS ノードを作成（roleId は source を引き継ぐ）
        const roleId = source.roleId ?? source.role?.id;
        const createRes = await fetch(`${API_URL}/api/business-flows/${flowData.id}/nodes`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            type: 'PROCESS',
            label: '新規処理',
            positionX: midX,
            positionY: midY,
            ...(roleId ? { roleId } : {}),
          }),
        });
        if (!createRes.ok) throw new Error('Failed to create node');
        const created = await createRes.json();
        const newNodeId: string | undefined = created?.id;
        if (!newNodeId) throw new Error('Created node has no id');

        // 2) 新ノードの order を中点に設定（位置は作成時に保存済み）
        const orderRes = await fetch(
          `${API_URL}/api/business-flows/${flowData.id}/nodes/${newNodeId}`,
          {
            method: 'PUT',
            headers,
            body: JSON.stringify({ order: midOrder }),
          },
        );
        if (!orderRes.ok) throw new Error('Failed to set new node order');

        // 3) source → 新ノード を接続（最近接サイドのハンドル付き）
        const e1 = await fetch(`${API_URL}/api/business-flows/${flowData.id}/edges`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            sourceNodeId: source.id,
            targetNodeId: newNodeId,
            sourceHandle: h1.sourceHandle,
            targetHandle: h1.targetHandle,
          }),
        });
        if (!e1.ok) throw new Error('Failed to connect source to new node');

        // 4) 新ノード → target を接続（最近接サイドのハンドル付き）
        const e2 = await fetch(`${API_URL}/api/business-flows/${flowData.id}/edges`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            sourceNodeId: newNodeId,
            targetNodeId: target.id,
            sourceHandle: h2.sourceHandle,
            targetHandle: h2.targetHandle,
          }),
        });
        if (!e2.ok) throw new Error('Failed to connect new node to target');

        // 5) 元の source → target エッジを削除
        const del = await fetch(
          `${API_URL}/api/business-flows/${flowData.id}/edges/${edgeId}`,
          { method: 'DELETE', headers },
        );
        if (!del.ok) throw new Error('Failed to delete original edge');

        // 再取得（新ノード・繋ぎ替え後のエッジを反映）
        fetchFlowData(flowData.id);
      } catch (err) {
        console.error('Failed to insert node on edge:', err);
      }
    },
    [flowData, fetchFlowData, getHeaders],
  );

  // スイムレーン（ロール）の手動リサイズ後の高さを永続化する。
  // PUT /api/business-flows/:flowId { laneHeights } に既存の laneHeights をマージして送る。
  // ノード位置を保ったまま反映するため、ローカル state も楽観更新する。
  const handleUpdateLaneHeight = useCallback(
    async (roleId: string, height: number) => {
      if (!flowData) return;
      const nextLaneHeights = { ...(flowData.laneHeights ?? {}), [roleId]: height };
      // 楽観更新（再取得で fitView がリセットされ位置が飛ぶのを防ぐ）
      setFlowData((prev) => (prev ? { ...prev, laneHeights: nextLaneHeights } : prev));
      try {
        const headers = getHeaders();
        const res = await fetch(`${API_URL}/api/business-flows/${flowData.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ laneHeights: nextLaneHeights }),
        });
        if (!res.ok) throw new Error('Failed to update lane height');
      } catch (err) {
        console.error('Failed to update lane height:', err);
      }
    },
    [flowData, getHeaders],
  );

  // 子フロー作成
  const handleChildFlowCreate = useCallback(
    async (nodeId: string, name?: string) => {
      if (!flowData) return;
      try {
        const headers = getHeaders();
        const res = await fetch(`${API_URL}/api/business-flows/${flowData.id}/nodes/${nodeId}/child-flow`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: name || '詳細フロー' }),
        });

        if (!res.ok) throw new Error('Failed to create child flow');
        const data = await res.json();
        
        // 子フローに移動
        if (data.childFlow?.id) {
          setFlowHistory((prev) => [...prev, data.childFlow.id]);
          fetchFlowData(data.childFlow.id);
        }
      } catch (err) {
        console.error('Failed to create child flow:', err);
      }
    },
    [flowData, fetchFlowData, getHeaders]
  );

  // ノードのダブルクリック → 詳細（子）フローへドリルダウン
  // childFlowId があればそのまま、無ければ child-flow を作成してから router.push で遷移
  const handleNodeDrillDown = useCallback(
    async (nodeId: string) => {
      const node = flowData?.nodes.find((n) => n.id === nodeId);
      if (node?.childFlowId) {
        router.push(`/dashboard/projects/${projectId}/flows/${node.childFlowId}`);
        return;
      }
      try {
        const headers = getHeaders();
        const res = await fetch(`${API_URL}/api/business-flows/nodes/${nodeId}/child-flow`, {
          method: 'POST',
          headers,
          body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error('Failed to create child flow');
        const data = await res.json();
        const childId = data?.childFlow?.id;
        if (childId) {
          router.push(`/dashboard/projects/${projectId}/flows/${childId}`);
        }
      } catch (err) {
        console.error('Failed to open child flow:', err);
      }
    },
    [flowData, projectId, router, getHeaders]
  );

  // ===========================================
  // クロスフロー入出力リンク（ノード単位）
  // ===========================================
  const handleFetchNodeLinks = useCallback(
    async (nodeId: string): Promise<NodeLinksResult> => {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/business-flows/nodes/${nodeId}/links`, { headers });
      if (!res.ok) throw new Error('Failed to fetch node links');
      const data = await res.json();
      return {
        nodeId: data.nodeId ?? nodeId,
        outgoing: Array.isArray(data.outgoing) ? data.outgoing : [],
        incoming: Array.isArray(data.incoming) ? data.incoming : [],
      };
    },
    [getHeaders]
  );

  const handleCreateNodeLink = useCallback(
    async (
      nodeId: string,
      input: { direction: FlowLinkDirection; targetFlowId: string; targetNodeId?: string; label?: string }
    ) => {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/business-flows/nodes/${nodeId}/links`, {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error('Failed to create node link');
      // ノードの links 表示（連携バッジ）を反映するため再取得
      if (flowData) fetchFlowData(flowData.id);
    },
    [flowData, fetchFlowData, getHeaders]
  );

  const handleDeleteNodeLink = useCallback(
    async (linkId: string) => {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/business-flows/node-links/${linkId}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) throw new Error('Failed to delete node link');
      if (flowData) fetchFlowData(flowData.id);
    },
    [flowData, fetchFlowData, getHeaders]
  );

  // 連携先フローのノード一覧（連携先ノード選択用）
  const handleFetchFlowNodes = useCallback(
    async (targetFlowId: string): Promise<Array<{ id: string; label: string }>> => {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/business-flows/${targetFlowId}`, { headers });
      if (!res.ok) return [];
      const data = await res.json();
      const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
      return nodes.map((n: { id: string; label: string }) => ({ id: n.id, label: n.label }));
    },
    [getHeaders]
  );

  // ===========================================
  // ノードINPUT/OUTPUT（情報種別マスタからの多選択）
  // PUT business-flows/:flowId/nodes/:nodeId/information-links で replace-all 保存 → 再取得。
  // ===========================================
  const handleSaveNodeInformationLinks = useCallback(
    async (
      nodeId: string,
      links: Array<{ informationTypeId: string; direction: FlowLinkDirection; order?: number }>
    ) => {
      if (!flowData) return;
      try {
        const headers = getHeaders();
        const res = await fetch(
          `${API_URL}/api/business-flows/${flowData.id}/nodes/${nodeId}/information-links`,
          {
            method: 'PUT',
            headers,
            body: JSON.stringify({ links }),
          }
        );
        if (!res.ok) throw new Error('Failed to save node information links');
        // 種類数/ラベルを反映するため再取得
        fetchFlowData(flowData.id);
      } catch (err) {
        console.error('Failed to save node information links:', err);
      }
    },
    [flowData, fetchFlowData, getHeaders]
  );

  // 情報種別マスタにその場で新規追加（ノード/矢印パネルから）。作成後に一覧を再取得して各セレクトへ反映。
  const handleCreateInformationType = useCallback(
    async (input: { name: string; category: InformationCategory }) => {
      try {
        const created = await informationTypeApi.create(projectId, input);
        setInformationTypes(await informationTypeApi.list(projectId));
        return created;
      } catch (err) {
        console.error('Failed to create information type:', err);
        return null;
      }
    },
    [projectId]
  );

  // ===========================================
  // 注釈（付箋・コメント）の追加・更新・削除
  // flowData.nodes/edges とは別系統。POST/PATCH/DELETE /business-flows/:flowId/annotations[/:id]。
  // 成功後は annotations 状態を楽観更新（位置/本文の小刻みな更新で再取得を避けちらつきを防ぐ）。
  // ===========================================
  const handleAddAnnotation = useCallback(
    async (
      kind: FlowAnnotation['kind'],
      init?: { positionX: number; positionY: number; icon?: string }
    ) => {
      if (!flowData) return;
      try {
        const headers = getHeaders();
        const res = await fetch(`${API_URL}/api/business-flows/${flowData.id}/annotations`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            kind,
            text: '',
            positionX: init?.positionX ?? 0,
            positionY: init?.positionY ?? 0,
            // アイコン注釈（kind==='ICON'）のときだけ lucide アイコン名を送る。
            ...(init?.icon ? { icon: init.icon } : {}),
          }),
        });
        if (!res.ok) throw new Error('Failed to create annotation');
        const created = (await res.json()) as FlowAnnotation;
        setAnnotations((prev) => [...prev, created]);
      } catch (err) {
        console.error('Failed to create annotation:', err);
      }
    },
    [flowData, getHeaders]
  );

  const handleUpdateAnnotation = useCallback(
    async (
      id: string,
      patch: {
        text?: string;
        positionX?: number;
        positionY?: number;
        /** マウスリサイズ後の描画幅/高さ（PATCH annotation で永続化）。 */
        width?: number;
        height?: number;
        color?: string | null;
        icon?: string | null;
        /** kind==='SCOPE' の枠線スタイル（点線/実線）。 */
        borderStyle?: 'dashed' | 'solid';
        /** kind==='SCOPE' の背景塗り不透明度（0〜1）。 */
        fillOpacity?: number;
      }
    ) => {
      if (!flowData) return;
      // 楽観更新（ドラッグ移動・本文編集が即座に反映され、再取得のちらつきを避ける）
      setAnnotations((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...patch } : a))
      );
      try {
        const headers = getHeaders();
        const res = await fetch(
          `${API_URL}/api/business-flows/${flowData.id}/annotations/${id}`,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify(patch),
          }
        );
        if (!res.ok) throw new Error('Failed to update annotation');
      } catch (err) {
        console.error('Failed to update annotation:', err);
        // 失敗時はサーバ状態へ戻す
        fetchAnnotations(flowData.id);
      }
    },
    [flowData, getHeaders, fetchAnnotations]
  );

  const handleDeleteAnnotation = useCallback(
    async (id: string) => {
      if (!flowData) return;
      // 楽観更新（削除を即座に反映）
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
      try {
        const headers = getHeaders();
        const res = await fetch(
          `${API_URL}/api/business-flows/${flowData.id}/annotations/${id}`,
          {
            method: 'DELETE',
            headers,
          }
        );
        if (!res.ok) throw new Error('Failed to delete annotation');
      } catch (err) {
        console.error('Failed to delete annotation:', err);
        fetchAnnotations(flowData.id);
      }
    },
    [flowData, getHeaders, fetchAnnotations]
  );

  // ===========================================
  // 表示ロール選択（フローごと localStorage 永続化）
  // ===========================================
  const rolesStorageKey = useMemo(() => `flow-roles-${flowId}`, [flowId]);

  // roles 取得・flow 切替時に選択状態を初期化（保存値があれば復元、無ければ全選択）
  useEffect(() => {
    if (roles.length === 0) {
      setSelectedRoleIds(null);
      return;
    }
    const allIds = roles.map((r) => r.id);
    let next = allIds;
    try {
      const raw = localStorage.getItem(rolesStorageKey);
      if (raw) {
        const saved = JSON.parse(raw) as string[];
        if (Array.isArray(saved)) {
          // 既に存在するロールのみに絞り込む
          const filtered = saved.filter((id) => allIds.includes(id));
          next = filtered.length > 0 ? filtered : allIds;
        }
      }
    } catch {
      next = allIds;
    }
    setSelectedRoleIds(next);
  }, [roles, rolesStorageKey]);

  // 表示対象のロール（選択中のみ）
  const visibleRoles = useMemo(() => {
    if (selectedRoleIds === null) return roles;
    const set = new Set(selectedRoleIds);
    return roles.filter((r) => set.has(r.id));
  }, [roles, selectedRoleIds]);

  // 選択状態を保存しつつ更新
  const persistSelectedRoles = useCallback(
    (ids: string[]) => {
      setSelectedRoleIds(ids);
      try {
        localStorage.setItem(rolesStorageKey, JSON.stringify(ids));
      } catch {
        /* noop */
      }
    },
    [rolesStorageKey]
  );

  // フロー途中でロールを追加（名前 + 人/システム区分）
  // 既存の getHeaders() ベース fetch で POST /api/roles する。
  // - projectId はクエリではなく body に入れる（バックエンド CreateRoleRequestDto.projectId は必須）。
  // - rolesApi.create（@/lib/api）は projectId をクエリに付けるだけで body に載せず、かつ
  //   トークンを 'token' キーで読む（本アプリは 'accessToken'）ため 401/400 になる。使わない。
  // 作成後はロール一覧を再取得し、追加したロールは表示選択にも含める。
  const handleAddRole = useCallback(
    async (name: string, type: RoleType) => {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/roles`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectId, name, type }),
      });
      if (!res.ok) throw new Error('Failed to create role');
      const created = (await res.json()) as Role;
      // 追加直後から図に出るよう、現在の選択（無指定=全選択）に新ロールを足して永続化。
      // この永続値を roles 再取得後の選択初期化 useEffect が拾い、新ロールも表示される。
      const current = selectedRoleIds ?? roles.map((r) => r.id);
      persistSelectedRoles(Array.from(new Set([...current, created.id])));
      await fetchRoles();
    },
    [projectId, selectedRoleIds, roles, persistSelectedRoles, fetchRoles, getHeaders]
  );

  // 個別業務定義の「次工程（渡し先ロール）」用にロールをその場で新規作成する。
  // POST /api/roles { projectId, name, type:'HUMAN' } → 一覧再取得 → 作成名を返す。
  const handleCreateDefinitionRole = useCallback(
    async (name: string): Promise<string | null> => {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/roles`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectId, name, type: 'HUMAN' }),
      });
      if (!res.ok) throw new Error('Failed to create role');
      const created = (await res.json()) as Role;
      await fetchRoles();
      return created.name;
    },
    [projectId, fetchRoles, getHeaders]
  );

  // ロール更新（名前 / 人・システム・その他 区分 / SYSTEM のとき system 紐づけ / 色）
  // PATCH /api/roles/:id に patch をそのまま送る → 成功後 fetchRoles で一覧更新。
  const handleUpdateRole = useCallback(
    async (
      roleId: string,
      patch: { name?: string; type?: RoleType; systemId?: string | null; color?: string }
    ) => {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/roles/${roleId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('Failed to update role');
      await fetchRoles();
    },
    [fetchRoles, getHeaders]
  );

  // ロール削除。DELETE /api/roles/:id → 成功後 fetchRoles で一覧更新。
  const handleDeleteRole = useCallback(
    async (roleId: string) => {
      // 誤クリックでレーンが消えないよう確認。担当ノードは削除されず「未割当」に戻る（FlowNode.role は SetNull）。
      const role = roles.find((r) => r.id === roleId);
      const assigned = (flowData?.nodes ?? []).filter(
        (n) => (n.roleId ?? n.role?.id ?? null) === roleId
      ).length;
      const msg = assigned > 0
        ? `ロール「${role?.name ?? ''}」を削除しますか？\nこのレーンの ${assigned} 件のノードは「未割当」に戻ります（ノード自体は消えません）。`
        : `ロール「${role?.name ?? ''}」を削除しますか？`;
      if (typeof window !== 'undefined' && !window.confirm(msg)) return;
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/roles/${roleId}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) throw new Error('Failed to delete role');
      await fetchRoles();
    },
    [fetchRoles, getHeaders, roles, flowData]
  );

  // ロールのチェック切替
  const toggleRole = useCallback(
    (roleId: string, checked: boolean) => {
      const current = selectedRoleIds ?? roles.map((r) => r.id);

      if (checked) {
        persistSelectedRoles(Array.from(new Set([...current, roleId])));
        return;
      }

      // 外す場合：このフロー内で当該ロールに割り当てられたノードがあるか確認
      const affected = (flowData?.nodes ?? []).filter((n) => n.roleId === roleId);
      if (affected.length === 0) {
        persistSelectedRoles(current.filter((id) => id !== roleId));
        return;
      }

      // 再割当先候補（外そうとしているロール以外）
      const otherRoles = roles.filter((r) => r.id !== roleId);
      const defaultTarget = otherRoles[0]?.id ?? '';
      setReassign({
        roleId,
        nodes: affected.map((n) => ({
          id: n.id,
          label: n.label,
          targetRoleId: defaultTarget,
        })),
      });
    },
    [selectedRoleIds, roles, flowData, persistSelectedRoles]
  );

  // 再割当ダイアログの確定：各ノードの roleId を更新 → 再取得 → チェックを外す
  const handleReassignConfirm = useCallback(async () => {
    if (!reassign || !flowData) return;
    setReassignBusy(true);
    try {
      const headers = getHeaders();
      for (const node of reassign.nodes) {
        if (!node.targetRoleId || node.targetRoleId === reassign.roleId) continue;
        const res = await fetch(`${API_URL}/api/business-flows/${flowData.id}/nodes/${node.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ roleId: node.targetRoleId }),
        });
        if (!res.ok) throw new Error('Failed to reassign node role');
      }

      const removedRoleId = reassign.roleId;
      setReassign(null);
      // 当該ロールのチェックを外す
      const current = selectedRoleIds ?? roles.map((r) => r.id);
      persistSelectedRoles(current.filter((id) => id !== removedRoleId));
      // 再取得（再割当の反映）
      fetchFlowData(flowData.id);
    } catch (err) {
      console.error('Failed to reassign nodes:', err);
    } finally {
      setReassignBusy(false);
    }
  }, [reassign, flowData, getHeaders, selectedRoleIds, roles, persistSelectedRoles, fetchFlowData]);

  // ===========================================
  // Mermaid から生成（import）
  // ===========================================
  const handleMermaidImport = useCallback(async () => {
    if (!flowData || !mermaidImportText.trim()) return;
    setMermaidImporting(true);
    setMermaidImportError(null);
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/business-flows/${flowData.id}/import-mermaid`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ mermaid: mermaidImportText }),
      });
      if (!res.ok) {
        let msg = 'Mermaidの取り込みに失敗しました';
        try {
          const body = await res.json();
          if (body?.message) msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
        } catch {
          /* noop */
        }
        throw new Error(msg);
      }
      setShowMermaidImport(false);
      setMermaidImportText('');
      fetchFlowData(flowData.id);
    } catch (err) {
      setMermaidImportError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setMermaidImporting(false);
    }
  }, [flowData, mermaidImportText, getHeaders, fetchFlowData]);

  // ===========================================
  // Undo/Redo（スナップショット型）
  //  - flowData の変化を捕捉してスタックへ push（debounce, restore 由来は除外）
  //  - localStorage `flow-undo-<flowId>` で状態を、DB /snapshots で履歴を保持
  //  - undo/redo は PUT /restore → fetchFlowData(silent) で適用
  // ===========================================
  const refetchSilent = useCallback(
    (id: string) => fetchFlowData(id, true),
    [fetchFlowData],
  );
  // Undo/Redo は「今表示しているフロー」を対象にする。子フローへドリルダウン中は
  // flowData.id がルートの params.flowId と異なる（router は変えず flowData だけ差し替える）ため、
  // ルート固定だと ⌘Z で親フローに飛んでしまう。表示中フロー id を渡してフローごとに履歴を持つ。
  const undoFlowId = flowData?.id ?? flowId;

  // 画像Undo（op-log）は SwimlaneCanvas 内の useImageOpLog が保持する。ここでは命令的ハンドルと
  // 操作可否だけを受け取り、フローのスナップショット Undo と ⌘Z を seq で統合する。
  const imageUndoApiRef = useRef<ImageUndoApi | null>(null);
  const [imgCanUndo, setImgCanUndo] = useState(false);
  const [imgCanRedo, setImgCanRedo] = useState(false);
  const handleImageUndoState = useCallback((s: { canUndo: boolean; canRedo: boolean }) => {
    setImgCanUndo(s.canUndo);
    setImgCanRedo(s.canRedo);
  }, []);

  const {
    canUndo: flowCanUndo,
    canRedo: flowCanRedo,
    undo: flowUndo,
    redo: flowRedo,
    peekUndoSeq: flowPeekUndo,
    peekRedoSeq: flowPeekRedo,
  } = useFlowUndoRedo({
    flowId: undoFlowId,
    flowData,
    getHeaders,
    refetch: refetchSilent,
  });

  // ⌘Z ルーター: フロー履歴と画像 op-log のうち「直近の操作」を seq で選んで取り消す/やり直す。
  // seq が大きいほど新しい。undo は大きい seq から、redo は（mirror として）小さい seq から戻す。
  // 一方が端（null）なら他方へ振る。両方端なら no-op。
  const combinedUndo = useCallback(() => {
    const img = imageUndoApiRef.current;
    const imgSeq = img ? img.peekUndoSeq() : null;
    const flowSeq = flowPeekUndo();
    if (imgSeq === null && flowSeq === null) return;
    if (flowSeq === null || (imgSeq !== null && imgSeq > flowSeq)) img?.undo();
    else flowUndo();
  }, [flowUndo, flowPeekUndo]);
  const combinedRedo = useCallback(() => {
    const img = imageUndoApiRef.current;
    const imgSeq = img ? img.peekRedoSeq() : null;
    const flowSeq = flowPeekRedo();
    if (imgSeq === null && flowSeq === null) return;
    if (flowSeq === null || (imgSeq !== null && imgSeq < flowSeq)) img?.redo();
    else flowRedo();
  }, [flowRedo, flowPeekRedo]);

  const canUndo = flowCanUndo || imgCanUndo;
  const canRedo = flowCanRedo || imgCanRedo;
  const undo = combinedUndo;
  const redo = combinedRedo;

  // ⌘Z=Undo / ⌘⇧Z（＋⌘Y）=Redo の専用キーバインド。
  // 共有の useKeyboardShortcuts は mod 系を「入力中でも常に発火」させる仕様（mod+s/i 用）のため、
  // 「INPUT/TEXTAREA/select/contentEditable フォーカス中は無視」を満たすべく window keydown を直接張る。
  // フロー図タブがアクティブな時のみ有効。最新の undo/redo/activeTab を ref 経由で参照する。
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  const activeTabRef = useRef(activeTab);
  undoRef.current = undo;
  redoRef.current = redo;
  activeTabRef.current = activeTab;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      if (activeTabRef.current !== 'flow') return;
      // 入力フォーカス中は無視（テキスト編集の Undo を奪わない）
      const t = e.target;
      if (t instanceof HTMLElement) {
        const tag = t.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable) {
          return;
        }
      }
      // ⌘⇧Z または ⌘Y = Redo、⌘Z = Undo
      const isRedo = (key === 'z' && e.shiftKey) || key === 'y';
      e.preventDefault();
      if (isRedo) redoRef.current();
      else if (key === 'z') undoRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // キーボードショートカット
  // ⌘/Ctrl+S … ブラウザ保存を抑止しつつ Mermaid出力（フローはノード編集時に自動保存される）
  // ⌘/Ctrl+I … mermaidから生成、Shift+/（?） … 操作方法
  useKeyboardShortcuts([
    {
      combo: 'shift+/',
      handler: () => howToRef.current?.querySelector('button')?.click(),
    },
    {
      combo: 'mod+s',
      whenTyping: true,
      handler: () => {
        if (flowData) fetchMermaid();
      },
    },
    {
      combo: 'mod+i',
      whenTyping: true,
      handler: () => {
        setMermaidImportError(null);
        setShowMermaidImport(true);
      },
    },
  ]);

  // ロールパネル外クリックで閉じる
  useEffect(() => {
    if (!showRolePanel) return;
    const onDown = (e: MouseEvent) => {
      if (rolePanelRef.current && !rolePanelRef.current.contains(e.target as Node)) {
        setShowRolePanel(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showRolePanel]);

  // Mermaidプレビュー用のレンダリング
  const [mermaidSvg, setMermaidSvg] = useState<string | null>(null);

  const renderMermaid = useCallback(async () => {
    if (!mermaidCode) return;
    try {
      const { svg } = await mermaid.render('mermaid-preview', mermaidCode);
      setMermaidSvg(svg);
    } catch (err) {
      console.error('Failed to render mermaid:', err);
      setMermaidSvg(null);
    }
  }, [mermaidCode]);

  useEffect(() => {
    if (showMermaid && mermaidCode) {
      renderMermaid();
    }
  }, [showMermaid, mermaidCode, renderMermaid]);

  // 初回ロード時のみ全画面スピナー。再取得中（flowData あり）はキャンバスを差し替えず
  // マウントしたままにする（ノード移動・複数選択移動・範囲選択・整形等で全画面/選択が解除されないように）。
  if (loading && !flowData) {
    return (
      <div className="flex items-center justify-center h-[600px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link href={`/dashboard/projects/${projectId}/flows`}>
          <Button variant="ghost" className="text-gray-600">
            <ArrowLeft className="w-4 h-4 mr-2" />
            フロー一覧に戻る
          </Button>
        </Link>
        <Card className="bg-white border-red-200">
          <CardContent className="py-8 text-center">
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!flowData) {
    return (
      <div className="space-y-4">
        <Link href={`/dashboard/projects/${projectId}/flows`}>
          <Button variant="ghost" className="text-gray-600">
            <ArrowLeft className="w-4 h-4 mr-2" />
            フロー一覧に戻る
          </Button>
        </Link>
        <Card className="bg-white border-gray-200">
          <CardContent className="py-8 text-center">
            <p className="text-gray-500">フローが見つかりません</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 h-full">
      {/* ヘッダー */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Link href={`/dashboard/projects/${projectId}/flows`}>
            <Button variant="ghost" className="text-gray-600">
              <ArrowLeft className="w-4 h-4 mr-2" />
              フロー一覧
            </Button>
          </Link>
          {/* 詳細フロー（parentId あり）なら親フローへ戻れる */}
          {flowData.parentId && (
            <Link href={`/dashboard/projects/${projectId}/flows/${flowData.parentId}`}>
              <Button variant="outline" className="text-gray-600">
                <ArrowLeft className="w-4 h-4 mr-2" />
                親フローへ戻る
              </Button>
            </Link>
          )}
          <span className="hidden items-center gap-1.5 text-sm font-medium text-gray-700 sm:inline-flex">
            {flowData.parentId ? '詳細フロー編集' : '業務フロー編集'}
            <HelpTooltip text="役割（ロール）ごとのスイムレーン上で処理を並べ、矢印でつなぐ図です。ノードのドラッグでロール移動・並び替えができ、ダブルクリックで子フロー（詳細フロー）に潜れます。" />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* このフローの担当者（FlowStakeholder の多対多）。チップ＋複数選択ポップオーバ。
              ポップオーバは portal + fixed でヘッダーの overflow クリップを回避。 */}
          <div className="flex flex-wrap items-center gap-1">
            <span className="hidden items-center gap-1 text-xs font-medium text-gray-500 sm:inline-flex">
              <Users className="h-3.5 w-3.5" />
              担当者
            </span>
            {(flowData.assignees ?? []).length === 0 && (
              <span className="text-xs text-gray-400">未割当</span>
            )}
            {(flowData.assignees ?? []).map((a) => (
              <span
                key={a.stakeholderId}
                className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] text-blue-800"
              >
                {a.name || stakeholderById.get(a.stakeholderId)?.name || '（不明）'}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => toggleAssignee(a.stakeholderId)}
                    disabled={assigneeSaving}
                    className="text-blue-500 hover:text-blue-800 disabled:opacity-50"
                    aria-label="外す"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {canEdit && (
              <button
                type="button"
                onClick={(e) => {
                  if (assigneePickerOpen) {
                    setAssigneePickerOpen(false);
                    return;
                  }
                  setAssigneePickerPos(clampAssigneePopover(e.currentTarget.getBoundingClientRect()));
                  setAssigneePickerOpen(true);
                }}
                disabled={stakeholders.length === 0 || assigneeSaving}
                className="flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Users className="h-3 w-3" />
                担当者
              </button>
            )}
            {/* 担当者保存エラー（ページ全体は落とさず、ここに小さく赤字で表示） */}
            {assigneeError && (
              <span className="text-[11px] text-red-600">{assigneeError}</span>
            )}
            {/* ポップオーバは portal + fixed でヘッダーの overflow クリップを回避 */}
            {canEdit &&
              assigneePickerOpen &&
              stakeholders.length > 0 &&
              assigneePickerPos &&
              createPortal(
                <>
                  <button
                    type="button"
                    aria-label="閉じる"
                    onClick={() => setAssigneePickerOpen(false)}
                    className="fixed inset-0 z-40 cursor-default"
                  />
                  <div
                    style={{
                      position: 'fixed',
                      top: assigneePickerPos.top,
                      left: assigneePickerPos.left,
                    }}
                    className="z-50 max-h-56 w-60 overflow-y-auto rounded-md border border-gray-200 bg-white p-1 shadow-lg"
                  >
                    {stakeholders.map((s) => {
                      const checked = (flowData.assignees ?? []).some(
                        (a) => a.stakeholderId === s.id,
                      );
                      return (
                        <label
                          key={s.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-gray-50"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={assigneeSaving}
                            onChange={() => toggleAssignee(s.id)}
                            className="h-3.5 w-3.5"
                          />
                          <span className="flex-1 text-gray-800">{s.name}</span>
                          {s.role && (
                            <span className="rounded bg-gray-100 px-1 text-[10px] text-gray-500">
                              {s.role}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </>,
                document.body,
              )}
          </div>
          {/* 操作ガイド */}
          <div ref={howToRef}>
            <HowToPanel
              title="業務フロー編集の使い方"
              steps={[
                'ノードをドラッグすると、別のロール（スイムレーン）への移動や並び替えができます。',
                'ノードのハンドルから別のノードへドラッグすると矢印（接続）を引けます。ノードを選ぶと右パネルでラベル・種別を編集できます。',
                '右上のツールバーで縦／横の向きを切り替え、PNG出力で図を画像として保存できます。',
                '「mermaidから生成」で Mermaid 記法を貼り付けて一括作成、「Mermaid出力」で図を Mermaid コードとして書き出せます。',
                '「ロール」で表示するスイムレーンを絞り込み。ノードをダブルクリックすると子フローへ移動します。',
              ]}
              shortcuts={[
                { keys: '⌘/Ctrl+S', desc: 'Mermaid出力を開く（自動保存のため上書き保存は不要）' },
                { keys: '⌘/Ctrl+I', desc: 'mermaidから生成ダイアログを開く' },
                { keys: 'Shift+/（?）', desc: 'この操作方法を開く' },
              ]}
            />
          </div>
          <ManualButton feature="flows" />
          {/* この業務フロー単体の JSON 入出力（entity-json：nodes/edges/定義/注釈/infoリンク丸ごと） */}
          <ExportImportButton
            label="業務フロー"
            fileBaseName={`flow-${flowData.name ?? flowData.id}`}
            size="sm"
            canEdit={canEdit}
            withModeChoice={false}
            importHint="選択した JSON でこの業務フローの中身（ノード・矢印・業務定義・注釈・情報リンク）を丸ごと置き換えます。注意: このバンドルに含まれない、矢印やノードに紐づくデータは巻き添えで消えます — 具体的にはインターフェース定義（IF定義）とその列、矢印⇔API連携リンク、クロスフロー入出力リンク（FlowNodeLink）。また CRUD マッピング・GAP の asis/tobe ノード参照・第2レベルDFDの FUNCTION ノード参照は NULL 化されます。childFlowId（業務ブロックの子フローへのリンク）は保持されますが、その子フローが別フローのノードに既に紐づいている場合はリンクを外して取り込みます。小さな編集のつもりで、これらの紐づけがあるフローへの get→PUT は避け、ノード/矢印単位のツールを使ってください。"
            getExport={() => entityJsonIo.exportFlow(flowData.id)}
            onImport={(parsed) =>
              entityJsonIo.importFlow(flowData.id, parsed as EntityBundle)
            }
            onDone={() => fetchFlowData(flowData.id)}
          />
          {/* フロー図タブのときだけ表示するツールバー */}
          {activeTab === 'flow' && (
          <>
          {/* ロール表示選択 */}
          <div className="relative" ref={rolePanelRef}>
            <Button
              variant="outline"
              onClick={() => setShowRolePanel((v) => !v)}
              className="text-gray-600"
            >
              <Users className="w-4 h-4 mr-2" />
              ロール
              {selectedRoleIds && roles.length > 0 && (
                <span className="ml-2 text-xs text-gray-500">
                  {selectedRoleIds.length}/{roles.length}
                </span>
              )}
            </Button>
            {showRolePanel && (
              <div className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] max-w-xs sm:w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                  表示するロール
                  <HelpTooltip text="ロールはスイムレーン（担当者・部署）です。チェックを外すと、そのレーンを図から非表示にできます（割り当て済みノードは再割当を求められます）。" />
                </div>
                {roles.length === 0 ? (
                  <p className="text-xs text-gray-400 py-2">ロールがありません</p>
                ) : (
                  <div className="space-y-1 max-h-72 overflow-auto">
                    {roles.map((r) => {
                      const checked = selectedRoleIds
                        ? selectedRoleIds.includes(r.id)
                        : true;
                      return (
                        <label
                          key={r.id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => toggleRole(r.id, e.target.checked)}
                            className="rounded border-gray-300"
                          />
                          <span
                            className="inline-block w-3 h-3 rounded-sm shrink-0"
                            style={{ backgroundColor: r.color }}
                          />
                          <span className="text-sm text-gray-800 truncate">{r.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                <div className="mt-3 pt-2 border-t border-gray-100 flex justify-end">
                  <button
                    type="button"
                    className="text-xs text-blue-600 hover:underline"
                    onClick={() => persistSelectedRoles(roles.map((rr) => rr.id))}
                  >
                    すべて表示
                  </button>
                </div>
              </div>
            )}
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setMermaidImportError(null);
              setShowMermaidImport(true);
            }}
            className="text-gray-600"
          >
            <Wand2 className="w-4 h-4 mr-2" />
            mermaidから生成
          </Button>
          <Button variant="outline" onClick={fetchMermaid} className="text-gray-600">
            <FileCode className="w-4 h-4 mr-2" />
            Mermaid出力
          </Button>
          </>
          )}
        </div>
      </div>

      {/* 現状把握タブ（フロー図 / 業務定義 / 情報の地図 CRUOA） */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {([
          { key: 'flow', label: 'フロー図', icon: GitBranch },
          { key: 'definition', label: '個別定義', icon: ClipboardList },
          { key: 'cruoa', label: '情報の地図(CRUOA)', icon: Grid3x3 },
          { key: 'dfd', label: 'DFD', icon: Share2 },
        ] as const).map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={`-mb-px flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-blue-600 text-blue-700 bg-blue-50'
                  : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
        {activeTab === 'flow' && flowData && (
          <button
            type="button"
            onClick={() => setGalleryOpen(true)}
            className="ml-auto -mb-px flex items-center gap-1.5 rounded-t-lg border-b-2 border-transparent px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800"
            title="このフローのノード・矢印に紐づく画像/ファイルを一覧表示"
          >
            <ImageIcon className="h-4 w-4" />
            紐づけ画像を表示
          </button>
        )}
      </div>

      {galleryOpen && flowData && (
        <FlowAttachmentsGallery
          projectId={projectId}
          nodes={flowData.nodes
            .filter((n) => n.type !== 'lane')
            .map((n) => ({ id: n.id, label: n.label }))}
          edges={flowData.edges.map((e) => ({ id: e.id, label: e.label ?? '' }))}
          onClose={() => setGalleryOpen(false)}
        />
      )}

      {/* フロービューアー（フロー図タブ） */}
      <div
        className={`h-[calc(100vh-240px)] border border-gray-200 rounded-lg overflow-hidden ${
          activeTab === 'flow' ? '' : 'hidden'
        }`}
      >
        <SwimlaneCanvas
          flowData={flowData}
          roles={visibleRoles}
          projectId={projectId}
          onImageUndoStateChange={handleImageUndoState}
          imageUndoApiRef={imageUndoApiRef}
          otherFlows={otherFlows}
          informationTypes={informationTypes}
          onSaveNodeInformationLinks={ro(handleSaveNodeInformationLinks)}
          onCreateInformationType={ro(handleCreateInformationType)}
          onBack={flowHistory.length > 1 ? handleBack : undefined}
          onUpdateFlow={ro(handleFlowUpdate)}
          onCreateNode={ro(handleNodeCreate)}
          onConnectNodes={ro(handleEdgeCreate)}
          onCreateConnectedNode={ro(handleCreateConnectedNode)}
          onDeleteNode={ro(handleNodeDelete)}
          onDeleteEdge={ro(handleEdgeDelete)}
          onReconnectEdge={ro(handleReconnectEdge)}
          onUpdateEdgeLabel={ro(handleEdgeLabelUpdate)}
          onUpdateEdge={ro(handleEdgeUpdate)}
          onInsertNodeOnEdge={ro(handleInsertNodeOnEdge)}
          onChangeNodeRole={ro(handleNodeRoleUpdate)}
          onUpdateNode={ro(handleNodeUpdate)}
          onUpdateLaneHeight={ro(handleUpdateLaneHeight)}
          onTidyNodes={ro(handleTidyNodes)}
          onUndo={ro(undo)}
          onRedo={ro(redo)}
          canUndo={canEdit && canUndo}
          canRedo={canEdit && canRedo}
          onCreateChildFlow={ro(handleChildFlowCreate)}
          onOpenChildFlow={handleNodeDoubleClick}
          onNodeDoubleClick={handleNodeDrillDown}
          onFetchNodeLinks={handleFetchNodeLinks}
          onCreateNodeLink={ro(handleCreateNodeLink)}
          onDeleteNodeLink={ro(handleDeleteNodeLink)}
          onFetchFlowNodes={handleFetchFlowNodes}
          onAddRole={ro(handleAddRole)}
          onUpdateRole={ro(handleUpdateRole)}
          onDeleteRole={ro(handleDeleteRole)}
          systems={systems}
          annotations={annotations}
          onAddAnnotation={ro(handleAddAnnotation)}
          onUpdateAnnotation={ro(handleUpdateAnnotation)}
          onDeleteAnnotation={ro(handleDeleteAnnotation)}
          apiEndpoints={apiEndpoints}
          onSaveEdgeApiLinks={ro(handleSaveEdgeApiLinks)}
        />
      </div>

      {/* 個別定義タブ（このフロー1本分の業務定義を編集） */}
      {activeTab === 'definition' && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
            <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
            <p className="text-sm text-blue-800">
              この業務フロー1本分の業務定義（目的・担当・関係者・INPUT・トリガー・DO手順・OUTPUT・次工程・例外処理・頻度・システム・暗黙知）を整理します。
              ここで保存した内容は「業務定義シート（全フロー一覧）」にも反映されます。
            </p>
          </div>
          <FlowDefinitionPanel
            flowId={flowId}
            projectId={projectId}
            roles={roles}
            nodes={flowData?.nodes ?? []}
            edges={flowData?.edges ?? []}
            informationTypes={informationTypes}
            onCreatedInformationType={(created) =>
              setInformationTypes((prev) =>
                prev.some((it) => it.id === created.id) ? prev : [...prev, created]
              )
            }
            onCreateRole={handleCreateDefinitionRole}
          />
        </div>
      )}

      {/* 情報の地図(CRUOA)タブ */}
      {activeTab === 'cruoa' && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3">
            <Grid3x3 className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />
            <p className="text-sm text-violet-800">
              情報がどう流れるかを可視化します。行=情報項目、列=ロール、各セルに
              C=作成 / R=参照 / U=更新 / O=出力 / A=承認 を付与し、二重管理（複数ロールが C/U）・属人化（作成者1名）を発見します。
            </p>
          </div>
          <CruoaMatrix flowId={flowId} roles={roles} />
        </div>
      )}

      {/* DFD（データフロー図）タブ */}
      {activeTab === 'dfd' && (
        <DfdPanel flowId={flowId} projectId={projectId} flowName={flowData.name} canEdit={canEdit} />
      )}

      {/* Mermaidモーダル（プレビュー機能付き） */}
      {showMermaid && mermaidCode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[85vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="font-bold text-gray-900">Mermaid出力</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowMermaid(false)}>
                ✕
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 overflow-auto max-h-[65vh]">
              {/* コード */}
              <div>
                <div className="text-sm font-medium text-gray-700 mb-2">コード</div>
                <pre className="bg-gray-50 p-4 rounded-lg text-xs overflow-auto max-h-[50vh] border border-gray-200">
                  <code>{mermaidCode}</code>
                </pre>
              </div>
              {/* プレビュー */}
              <div>
                <div className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                  <Eye className="w-4 h-4" />
                  プレビュー
                </div>
                <div className="bg-white p-4 rounded-lg border border-gray-200 overflow-auto max-h-[50vh]">
                  {mermaidSvg ? (
                    <div dangerouslySetInnerHTML={{ __html: mermaidSvg }} />
                  ) : (
                    <div className="text-gray-400 text-sm text-center py-8">
                      プレビュー読み込み中...
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 p-4 border-t border-gray-200">
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(mermaidCode);
                }}
              >
                コードをコピー
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  // マークダウン形式でコピー
                  const markdown = '```mermaid\n' + mermaidCode + '\n```';
                  navigator.clipboard.writeText(markdown);
                }}
              >
                Markdown形式でコピー
              </Button>
              <Button onClick={() => setShowMermaid(false)}>閉じる</Button>
            </div>
          </div>
        </div>
      )}

      {/* 再割当ダイアログ（ロールを非表示にする際、所属ノードを別ロールへ） */}
      <Dialog
        open={!!reassign}
        onOpenChange={(open) => {
          if (!open && !reassignBusy) setReassign(null);
        }}
      >
        <DialogContent className="bg-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-gray-900">ノードの再割当</DialogTitle>
            <DialogDescription className="text-gray-500">
              「{roles.find((r) => r.id === reassign?.roleId)?.name ?? 'このロール'}
              」を非表示にする前に、所属するノードの割当先ロールを選んでください。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[50vh] overflow-auto">
            {reassign?.nodes.map((node, idx) => (
              <div key={node.id} className="flex items-center gap-3">
                <span className="flex-1 text-sm text-gray-800 truncate">{node.label}</span>
                <select
                  className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white text-gray-800 min-w-[140px]"
                  value={node.targetRoleId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setReassign((prev) =>
                      prev
                        ? {
                            ...prev,
                            nodes: prev.nodes.map((n, i) =>
                              i === idx ? { ...n, targetRoleId: val } : n
                            ),
                          }
                        : prev
                    );
                  }}
                >
                  {roles
                    .filter((r) => r.id !== reassign?.roleId)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReassign(null)}
              disabled={reassignBusy}
            >
              キャンセル
            </Button>
            <Button
              onClick={handleReassignConfirm}
              disabled={
                reassignBusy ||
                roles.filter((r) => r.id !== reassign?.roleId).length === 0
              }
            >
              {reassignBusy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              確定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mermaidから生成ダイアログ */}
      <Dialog
        open={showMermaidImport}
        onOpenChange={(open) => {
          if (!open && !mermaidImporting) setShowMermaidImport(false);
        }}
      >
        <DialogContent className="bg-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5 text-gray-900">
              mermaidから生成
              <HelpTooltip text="Mermaid はテキストで図を書く記法です。flowchart の定義を貼り付けると、ロール・ノード・接続を解析してこのフローへ一括で追加します。" />
            </DialogTitle>
            <DialogDescription className="text-gray-500">
              Mermaid記法のテキストを貼り付けると、ロール・ノード・接続をこのフローに追加します。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={mermaidImportText}
            onChange={(e) => setMermaidImportText(e.target.value)}
            placeholder={'flowchart TD\n  A[受注] --> B[出荷]'}
            rows={12}
            className="font-mono text-xs text-gray-800 min-h-[240px]"
            disabled={mermaidImporting}
          />
          {mermaidImportError && (
            <div className="flex items-start gap-2 text-sm text-red-600">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{mermaidImportError}</span>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setMermaidImportText(MERMAID_SAMPLE)}
              disabled={mermaidImporting}
              className="mr-auto text-gray-600"
              title="サンプルで上書きします"
            >
              サンプルを表示
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowMermaidImport(false)}
              disabled={mermaidImporting}
            >
              キャンセル
            </Button>
            <Button
              onClick={handleMermaidImport}
              disabled={mermaidImporting || !mermaidImportText.trim()}
            >
              {mermaidImporting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              生成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

