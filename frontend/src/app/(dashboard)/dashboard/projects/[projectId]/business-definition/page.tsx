'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
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
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { ManualButton } from '@/components/ui/manual-dialog';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  ClipboardList,
  GitBranch,
  Pencil,
  AlertCircle,
  Paperclip,
  Trash2,
  Plus,
  FileText,
} from 'lucide-react';
import {
  flowDefinitionApi,
  definitionToRow,
  type FlowDefinitionRow,
  type FlowDefinition,
} from '@/lib/flow-definition';
import { flowAttachmentApi, type FlowAttachment } from '@/lib/flow-attachments';
import { informationTypeApi, type InformationType } from '@/lib/dfd';
import { InformationTypePicker } from '@/components/masters/InformationTypePicker';
import { systemApi, type SystemMaster } from '@/lib/masters';
import { listRoles, type Role } from '@/lib/stakeholders';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

/** JSON API 用ヘッダ（Bearer accessToken）。ロール新規作成（POST /api/roles）で使う */
function jsonAuthHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

// INPUT/OUTPUT で扱う「物体・情報・帳票」は情報種別マスタ（InformationType）から引く。
const INFO_CATEGORY_LABEL: Record<string, string> = {
  INFORMATION: '情報',
  OBJECT: '物体',
  DOCUMENT: '帳票',
};
// 入出力候補に使う列キー（情報種別マスタの datalist を付ける）
// INPUT/OUTPUT のフリーテキストはモーダルでの手動補足のみ（一覧では情報リンク集計をチップ表示）。
const INFO_DATALIST_ID = 'bd-information-types';
const INFO_KEYS = new Set<keyof FlowDefinition>(['input', 'output']);

// モーダルでロール（Role マスタ）の選択式にする列キー（担当・次工程）
const ROLE_FIELD_KEYS = new Set<keyof FlowDefinition>(['owner', 'nextProcess']);

// インライン編集できる単純列（DO は要約 + 個別定義への導線なので除く）
// INPUT は INPUT列（情報リンク集計のチップ）の前、OUTPUT は DO の後ろのチップ列なので、
// インライン編集対象からは外している（目的・担当のみ前半でインライン編集）。
const EDITABLE_COLUMNS: { key: keyof FlowDefinition; label: string }[] = [
  { key: 'purpose', label: '目的' },
  { key: 'owner', label: '担当' },
];
const EDITABLE_COLUMNS_TAIL: { key: keyof FlowDefinition; label: string }[] = [
  { key: 'frequency', label: '頻度' },
  { key: 'system', label: 'システム' },
];

// モーダルで編集する単一行テキスト項目
const MODAL_TEXT_FIELDS: { key: keyof FlowDefinition; label: string }[] = [
  { key: 'purpose', label: '目的' },
  { key: 'owner', label: '担当' },
  { key: 'frequency', label: '頻度' },
  { key: 'system', label: 'システム' },
  { key: 'trigger', label: 'トリガー' },
  // INPUT/OUTPUT は情報リンク集計が正。ここは手動補足メモのみ。
  { key: 'input', label: 'INPUT 補足（手動）' },
  { key: 'output', label: 'OUTPUT 補足（手動）' },
  { key: 'nextProcess', label: '次工程' },
];

// モーダルで編集する複数行テキスト項目（textarea）
// 注: INPUT/OUTPUT はノードの情報リンク集計が正のため、冗長な inputDetail はモーダルから除外（スキーマ列は残置）。
const MODAL_TEXTAREA_FIELDS: { key: keyof FlowDefinition; label: string }[] = [
  { key: 'stakeholders', label: '関係者' },
  { key: 'exceptionHandling', label: '例外処理' },
  { key: 'tacitNotes', label: '暗黙知メモ' },
];

// モーダルのフォーム値（doSteps は改行区切りの文字列で扱う）
type EditableTextKey = Exclude<keyof FlowDefinition, 'flowId' | 'doSteps'>;
type ModalForm = Record<EditableTextKey, string> & { doSteps: string };

function definitionToForm(def: FlowDefinition): ModalForm {
  return {
    purpose: def.purpose ?? '',
    owner: def.owner ?? '',
    stakeholders: def.stakeholders ?? '',
    input: def.input ?? '',
    inputDetail: def.inputDetail ?? '',
    trigger: def.trigger ?? '',
    output: def.output ?? '',
    nextProcess: def.nextProcess ?? '',
    exceptionHandling: def.exceptionHandling ?? '',
    frequency: def.frequency ?? '',
    system: def.system ?? '',
    tacitNotes: def.tacitNotes ?? '',
    doSteps: (def.doSteps ?? []).join('\n'),
  };
}

function stepsToText(steps: string[]): string {
  return (steps ?? []).join('\n');
}

function textToSteps(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** バイト数を読みやすい単位に整形 */
function formatBytes(size: number): string {
  if (!size || size <= 0) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 親子（parentId 自己参照）でツリー化し、DFS順（親→その子→孫…）に並べ替える。
 * ルートは parentId==null、または親が一覧に存在しないもの（孤児はルート扱い）。
 * 元の並び（createdAt 昇順）を兄弟間で保つ。循環は訪問済みセットで防ぐ。
 */
function toTreeOrder(rows: FlowDefinitionRow[]): FlowDefinitionRow[] {
  const byId = new Map<string, FlowDefinitionRow>(rows.map((r) => [r.flowId, r]));
  const childrenOf = new Map<string, FlowDefinitionRow[]>();
  const roots: FlowDefinitionRow[] = [];

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

  const ordered: FlowDefinitionRow[] = [];
  const visited = new Set<string>();
  const walk = (node: FlowDefinitionRow) => {
    if (visited.has(node.flowId)) return; // 循環防止
    visited.add(node.flowId);
    ordered.push(node);
    for (const child of childrenOf.get(node.flowId) ?? []) walk(child);
  };
  for (const root of roots) walk(root);
  // 取りこぼし（循環の輪に含まれて未訪問のもの）は末尾に救済
  for (const r of rows) if (!visited.has(r.flowId)) ordered.push(r);

  return ordered;
}

/** フォームと元定義を比較し、変わったフィールドだけの patch を作る */
function buildPatch(def: FlowDefinition, form: ModalForm): Partial<FlowDefinition> {
  const patch: Partial<FlowDefinition> = {};

  for (const { key } of [...MODAL_TEXT_FIELDS, ...MODAL_TEXTAREA_FIELDS]) {
    const k = key as EditableTextKey;
    const original = (def[k] as string | null) ?? '';
    const next = form[k];
    if (next !== original) {
      // 空文字は null として保存（DB の null 表現に合わせる）
      (patch as Record<string, unknown>)[k] = next === '' ? null : next;
    }
  }

  const nextSteps = textToSteps(form.doSteps);
  if (stepsToText(nextSteps) !== stepsToText(def.doSteps ?? [])) {
    patch.doSteps = nextSteps;
  }

  return patch;
}

/**
 * INPUT/OUTPUT 列のセル。
 * 主役はノードの情報リンク集計（items＝情報種別名）をチップ表示。空なら「—」。
 * フリーテキスト（note）は手動補足として小さく併記（編集はモーダルのみ）。
 */
function InfoLinkCell({
  items,
  note,
  tone,
}: {
  items: string[];
  note: string | null;
  tone: 'input' | 'output';
}) {
  const chipClass =
    tone === 'input'
      ? 'bg-sky-50 text-sky-700 border-sky-200'
      : 'bg-violet-50 text-violet-700 border-violet-200';
  const trimmedNote = (note ?? '').trim();
  return (
    <div className="min-w-[140px] space-y-1">
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {items.map((name) => (
            <span
              key={name}
              className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${chipClass}`}
            >
              {name}
            </span>
          ))}
        </div>
      ) : (
        <span className="text-gray-400">—</span>
      )}
      {trimmedNote && (
        <p className="text-[11px] leading-snug text-gray-400" title={trimmedNote}>
          補足: {trimmedNote}
        </p>
      )}
    </div>
  );
}

// Radix Select は value="" を許可しない（過去に空文字 SelectItem でクラッシュした前例あり）ため、
// 「未設定」はセンチネル値で表し、onChange 時に空文字へ変換する。
const NONE_VALUE = '__none__';

/**
 * マスタ（ロール・システム等）の「名前」を選ぶ汎用セレクト＋「＋新規追加」。
 * - 値は従来どおり文字列カラムに保存する（後方互換）。
 * - 一覧に無い既存フリーテキスト値は補助 option として残す。
 * - 「＋」からその場で新規追加（onCreate）→ 成功したら作成名を即選択。
 */
function MasterSelectField({
  value,
  options,
  onChange,
  onCreate,
  disabled,
  placeholder = '— 未設定 —',
  createTitle,
  createPlaceholder,
}: {
  /** 現在値（空文字 = 未設定） */
  value: string;
  /** 選択候補の名前一覧（重複・空は内部で除去） */
  options: string[];
  onChange: (value: string) => void;
  /** 「追加して選択」確定時。マスタ作成＋呼び出し側一覧への反映まで行う（throw でエラー表示） */
  onCreate: (name: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  createTitle: string;
  createPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // 空・重複を除いた候補名
  const names = options.filter((n, i) => n && options.indexOf(n) === i);
  const currentInList = value === '' || names.includes(value);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setCreateError('名称を入力してください');
      return;
    }
    setSaving(true);
    setCreateError(null);
    try {
      await onCreate(trimmed);
      onChange(trimmed);
      setOpen(false);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : '作成に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Select
        value={value === '' ? NONE_VALUE : value}
        onValueChange={(v) => onChange(v === NONE_VALUE ? '' : v)}
        disabled={disabled}
      >
        <SelectTrigger className="h-9 w-full border-gray-300 bg-white text-sm text-gray-900">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="bg-white">
          <SelectItem value={NONE_VALUE}>{placeholder}</SelectItem>
          {/* マスタ未登録の既存フリーテキスト値も選択肢として残す（後方互換）。
              Radix Select は value="" を許可しないため、空文字の補助 option は出さない。 */}
          {!currentInList && <SelectItem value={value}>{value}</SelectItem>}
          {names.map((n) => (
            <SelectItem key={n} value={n}>
              {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-9 w-9 shrink-0"
        title={createTitle}
        disabled={disabled}
        onClick={() => {
          setName('');
          setCreateError(null);
          setOpen(true);
        }}
      >
        <Plus className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{createTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-gray-600">名称</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={createPlaceholder}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
            </div>
            {createError && <p className="text-sm text-red-600">{createError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              キャンセル
            </Button>
            <Button onClick={() => void submit()} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              追加して選択
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function BusinessDefinitionPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [rows, setRows] = useState<FlowDefinitionRow[]>([]);
  const [infoTypes, setInfoTypes] = useState<InformationType[]>([]);
  // モーダルの選択式項目用マスタ（担当・次工程 = ロール / システム = System マスタ）
  const [roles, setRoles] = useState<Role[]>([]);
  const [systems, setSystems] = useState<SystemMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 編集モーダル state
  const [editingRow, setEditingRow] = useState<FlowDefinitionRow | null>(null);
  const [form, setForm] = useState<ModalForm | null>(null);
  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // 業務フロー添付ファイル（モーダル内の関連資料セクション）state
  const [attachments, setAttachments] = useState<FlowAttachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentUploading, setAttachmentUploading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    flowDefinitionApi
      .listByProject(projectId)
      .then((data) => {
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // INPUT/OUTPUT の候補（物体・情報・帳票）を情報種別マスタから取得。失敗しても本体は動かす。
  useEffect(() => {
    let cancelled = false;
    informationTypeApi
      .list(projectId)
      .then((data) => {
        if (!cancelled) setInfoTypes(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setInfoTypes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // 担当・次工程の候補（ロール）とシステムの候補（System マスタ）を取得。失敗しても本体は動かす。
  useEffect(() => {
    let cancelled = false;
    listRoles(projectId)
      .then((data) => {
        if (!cancelled) setRoles(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setRoles([]);
      });
    systemApi
      .list(projectId)
      .then((data) => {
        if (!cancelled) setSystems(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setSystems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // ロールの新規追加（POST /api/roles {projectId,name,type:'HUMAN'}）→ 再取得して候補へ反映
  const createRole = useCallback(
    async (name: string) => {
      const res = await fetch(`${API_URL}/api/roles`, {
        method: 'POST',
        headers: jsonAuthHeaders(),
        body: JSON.stringify({ projectId, name, type: 'HUMAN' }),
      });
      if (!res.ok) throw new Error('ロールの作成に失敗しました');
      const list = await listRoles(projectId);
      setRoles(Array.isArray(list) ? list : []);
    },
    [projectId]
  );

  // システムの新規追加（systemApi.create {name, kind:'PERIPHERAL'}）→ 候補へ反映
  const createSystem = useCallback(
    async (name: string) => {
      const created = await systemApi.create(projectId, { name, kind: 'PERIPHERAL' });
      setSystems((prev) => [...prev, created]);
    },
    [projectId]
  );

  // セルの値をローカル state に反映（onChange）
  const setCell = useCallback((flowId: string, key: keyof FlowDefinition, value: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.flowId === flowId ? { ...r, definition: { ...r.definition, [key]: value } } : r
      )
    );
  }, []);

  // onBlur で該当キーのみ upsert
  const commitCell = useCallback(
    async (flowId: string, key: keyof FlowDefinition, value: string) => {
      const saveKey = `${flowId}:${key}`;
      setSavingKey(saveKey);
      setSaveError(null);
      try {
        await flowDefinitionApi.upsert(flowId, { [key]: value } as Partial<FlowDefinition>);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : '保存に失敗しました');
      } finally {
        setSavingKey((cur) => (cur === saveKey ? null : cur));
      }
    },
    []
  );

  const openEdit = useCallback((row: FlowDefinitionRow) => {
    setEditingRow(row);
    setForm(definitionToForm(row.definition));
    setModalError(null);
  }, []);

  const closeEdit = useCallback(() => {
    setEditingRow(null);
    setForm(null);
    setModalError(null);
    setAttachments([]);
    setAttachmentError(null);
  }, []);

  // 一覧表の添付数バッジ（📎n）をモーダル内の操作に追随させる
  const syncRowAttachmentCount = useCallback((flowId: string, count: number) => {
    setRows((prev) =>
      prev.map((r) => (r.flowId === flowId ? { ...r, attachmentCount: count } : r))
    );
  }, []);

  // モーダルを開いたフローの添付ファイル一覧を取得
  useEffect(() => {
    if (!editingRow) return;
    const flowId = editingRow.flowId;
    let cancelled = false;
    setAttachmentsLoading(true);
    setAttachmentError(null);
    flowAttachmentApi
      .list(flowId)
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setAttachments(list);
        syncRowAttachmentCount(flowId, list.length);
      })
      .catch((err) => {
        if (!cancelled)
          setAttachmentError(err instanceof Error ? err.message : '添付ファイルの取得に失敗しました');
      })
      .finally(() => {
        if (!cancelled) setAttachmentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editingRow, syncRowAttachmentCount]);

  // 添付ファイルをアップロード（選択即アップロード・複数可）。完了後に一覧を再取得して更新
  const uploadAttachments = useCallback(
    async (files: File[]) => {
      if (!editingRow || files.length === 0) return;
      const flowId = editingRow.flowId;
      setAttachmentUploading(true);
      setAttachmentError(null);
      const failed: string[] = [];
      for (const file of files) {
        try {
          await flowAttachmentApi.upload(flowId, file);
        } catch {
          failed.push(file.name);
        }
      }
      try {
        const list = await flowAttachmentApi.list(flowId);
        const next = Array.isArray(list) ? list : [];
        setAttachments(next);
        syncRowAttachmentCount(flowId, next.length);
      } catch {
        // 一覧再取得の失敗は無視（次回モーダルを開いた時に取得される）
      }
      if (failed.length > 0) {
        setAttachmentError(`アップロードに失敗しました: ${failed.join('、')}`);
      }
      setAttachmentUploading(false);
    },
    [editingRow, syncRowAttachmentCount]
  );

  // 添付ファイルを削除（confirm 付き）
  const deleteAttachment = useCallback(
    async (attachment: FlowAttachment) => {
      if (!window.confirm(`「${attachment.filename}」を削除しますか？`)) return;
      setAttachmentError(null);
      try {
        await flowAttachmentApi.remove(attachment.id);
        const next = attachments.filter((a) => a.id !== attachment.id);
        setAttachments(next);
        const flowId = attachment.flowId ?? editingRow?.flowId;
        if (flowId) syncRowAttachmentCount(flowId, next.length);
      } catch (err) {
        setAttachmentError(err instanceof Error ? err.message : '削除に失敗しました');
      }
    },
    [attachments, editingRow, syncRowAttachmentCount]
  );

  const setFormField = useCallback((key: keyof ModalForm, value: string) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }, []);

  const saveModal = useCallback(async () => {
    if (!editingRow || !form) return;
    const patch = buildPatch(editingRow.definition, form);
    // 変更がなければ閉じるだけ
    if (Object.keys(patch).length === 0) {
      closeEdit();
      return;
    }
    setModalSaving(true);
    setModalError(null);
    try {
      const updated = await flowDefinitionApi.upsert(editingRow.flowId, patch);
      setRows((prev) =>
        prev.map((r) =>
          r.flowId === editingRow.flowId ? { ...r, definition: updated } : r
        )
      );
      closeEdit();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setModalSaving(false);
    }
  }, [editingRow, form, closeEdit]);

  const help =
    '全業務フローの業務定義を1行ずつ俯瞰します。目的・担当・頻度・システムはこの表で直接編集（フォーカスを外すと自動保存）できます。INPUT/OUTPUT は各フローのノードに紐づけた情報リンク（情報種別）から自動集計してチップ表示します（業務フロー側で編集）。「編集」ボタンからは目的・関係者・DO手順・例外処理などをモーダルでまとめて編集できます。担当・次工程はロール、システムはシステムマスタ、INPUT/OUTPUT 補足は情報種別から選択でき（＋で新規追加）、写真・スクショの添付もモーダルから行えます。';

  // 親子階層（parentId）で DFS 順に並べ替えた表示用の行
  const treeRows = toTreeOrder(rows);

  return (
    <div className="space-y-5">
      {/* INPUT/OUTPUT 入力の候補（情報種別マスタ＝物体・情報・帳票）。表・モーダル双方の input が list で参照 */}
      <datalist id={INFO_DATALIST_ID}>
        {infoTypes.map((it) => (
          <option key={it.id} value={it.name}>
            {INFO_CATEGORY_LABEL[it.category] ?? it.category}
          </option>
        ))}
      </datalist>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-blue-600" />
            業務定義シート
          </span>
        }
        description="全業務フローの業務定義を一覧・編集"
        help={help}
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
        actions={
          <>
            <HowToPanel
              title="業務定義シートの使い方"
              steps={[
                '行は1つの業務フローです。業務フロー名をクリックすると、そのフローの「個別定義」タブを開きます。',
                '目的・担当・頻度・システムの各セルは直接入力でき、フォーカスを外すと自動保存されます。',
                'INPUT/OUTPUT は各フローのノードに紐づけた情報リンク（情報種別）から自動集計したチップを表示します。内容を変えるには業務フロー側でノードの入出力を編集してください。',
                '「編集」ボタンでは目的・関係者・DO手順・例外処理などをモーダルでまとめて編集できます。担当・次工程・システム・INPUT/OUTPUT 補足はマスタから選択でき（＋ボタンで新規追加して即選択）、写真・スクショの添付（複数可）もモーダル下部から行えます。',
                '「業務フローへ」ボタンで、そのフローの業務フローエディタへ移動できます。',
              ]}
            />
            <ManualButton feature="business-definition" />
          </>
        }
      />

      {saveError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {saveError}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        </div>
      ) : error ? (
        <Card className="bg-white border-red-200">
          <CardContent className="py-8 text-center">
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card className="bg-white border-gray-200">
          <CardContent className="space-y-3 py-12 text-center">
            <GitBranch className="mx-auto h-8 w-8 text-gray-300" />
            <p className="text-gray-500">業務フローがまだありません。</p>
            <Link href={`/dashboard/projects/${projectId}/flows`}>
              <Button variant="outline" className="text-gray-700">
                業務フローを作成する
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-white border-gray-200">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[1080px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold text-gray-500">
                  <th className="px-3 py-2.5">業務フロー名</th>
                  <th className="px-3 py-2.5">目的</th>
                  <th className="px-3 py-2.5">担当</th>
                  <th className="px-3 py-2.5">INPUT</th>
                  <th className="px-3 py-2.5">DO</th>
                  <th className="px-3 py-2.5">OUTPUT</th>
                  <th className="px-3 py-2.5">頻度</th>
                  <th className="px-3 py-2.5">システム</th>
                  <th className="px-3 py-2.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {treeRows.map((row) => {
                  const view = definitionToRow(row.definition);
                  const flowHref = `/dashboard/projects/${projectId}/flows/${row.flowId}`;
                  const isChild = row.depth > 0;
                  return (
                    <tr key={row.flowId} className="border-b border-gray-100 align-top">
                      {/* 業務フロー名: 親子インデント + ツリーインジケータ + 左側「業務フローへ」導線 + 名前リンク */}
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <div
                          className="flex items-center gap-1.5"
                          style={{ paddingLeft: row.depth * 20 }}
                        >
                          {/* 子行はツリーらしい階層インジケータ（└─）と淡い縦ボーダー */}
                          {isChild && (
                            <span className="flex shrink-0 items-center self-stretch border-l-2 border-gray-200 pl-1 text-gray-300">
                              └─
                            </span>
                          )}
                          {/* 行の左側に置いた「業務フローへ」導線（アイコン付きの小リンク） */}
                          <Link
                            href={flowHref}
                            title="業務フローへ"
                            aria-label="業務フローへ"
                            className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-blue-600 hover:bg-blue-50 hover:underline"
                          >
                            <GitBranch className="h-3 w-3" />
                            業務フローへ
                          </Link>
                          <Link
                            href={flowHref}
                            className="group inline-flex max-w-[220px] items-center gap-2"
                            title={row.flowName}
                          >
                            <span
                              className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                row.kind === 'ASIS'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-emerald-100 text-emerald-700'
                              }`}
                            >
                              {row.kind}
                            </span>
                            <span className="truncate font-medium text-gray-900 group-hover:text-blue-600 group-hover:underline">
                              {row.flowName}
                            </span>
                          </Link>
                          {/* 添付（写真・スクショ）の件数バッジ */}
                          {(row.attachmentCount ?? 0) > 0 && (
                            <span
                              className="inline-flex shrink-0 items-center gap-0.5 rounded bg-gray-100 px-1 py-0.5 text-[10px] font-medium text-gray-500"
                              title={`添付 ${row.attachmentCount} 件`}
                            >
                              <Paperclip className="h-3 w-3" />
                              {row.attachmentCount}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* インライン編集セル（前半: 目的・担当） */}
                      {EDITABLE_COLUMNS.map((c) => (
                        <td key={c.key} className="px-3 py-2.5">
                          <input
                            value={(row.definition[c.key] as string | null) ?? ''}
                            onChange={(e) => setCell(row.flowId, c.key, e.target.value)}
                            onBlur={(e) => commitCell(row.flowId, c.key, e.target.value)}
                            disabled={savingKey === `${row.flowId}:${c.key}`}
                            list={INFO_KEYS.has(c.key) ? INFO_DATALIST_ID : undefined}
                            className="w-full min-w-[120px] rounded border border-transparent bg-transparent px-2 py-1 text-gray-900 hover:border-gray-200 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-300 disabled:opacity-50"
                            placeholder="—"
                          />
                        </td>
                      ))}

                      {/* INPUT: ノードの情報リンク集計をチップ表示（正）。input はモーダルのみの手動補足 */}
                      <td className="px-3 py-2.5">
                        <InfoLinkCell items={row.inputItems} note={row.definition.input} tone="input" />
                      </td>

                      {/* DO: 要約（読み取り専用）+ 編集ボタン */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-start gap-2">
                          <span className="min-w-[120px] flex-1 text-gray-700">
                            {view.doSummary || <span className="text-gray-400">—</span>}
                          </span>
                          <button
                            type="button"
                            onClick={() => openEdit(row)}
                            className="inline-flex shrink-0 items-center gap-1 text-xs text-blue-600 hover:underline"
                          >
                            <Pencil className="h-3 w-3" />
                            編集
                          </button>
                        </div>
                      </td>

                      {/* OUTPUT: ノードの情報リンク集計をチップ表示（正）。output はモーダルのみの手動補足 */}
                      <td className="px-3 py-2.5">
                        <InfoLinkCell items={row.outputItems} note={row.definition.output} tone="output" />
                      </td>

                      {/* インライン編集セル（後半: 頻度・システム） */}
                      {EDITABLE_COLUMNS_TAIL.map((c) => (
                        <td key={c.key} className="px-3 py-2.5">
                          <input
                            value={(row.definition[c.key] as string | null) ?? ''}
                            onChange={(e) => setCell(row.flowId, c.key, e.target.value)}
                            onBlur={(e) => commitCell(row.flowId, c.key, e.target.value)}
                            disabled={savingKey === `${row.flowId}:${c.key}`}
                            list={INFO_KEYS.has(c.key) ? INFO_DATALIST_ID : undefined}
                            className="w-full min-w-[100px] rounded border border-transparent bg-transparent px-2 py-1 text-gray-900 hover:border-gray-200 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-300 disabled:opacity-50"
                            placeholder="—"
                          />
                        </td>
                      ))}

                      {/* 操作: 編集モーダル（「業務フローへ」導線は業務フロー名セルの左側へ移動） */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => openEdit(row)}
                            className="h-7 gap-1 px-2 text-xs text-gray-700"
                          >
                            <Pencil className="h-3 w-3" />
                            編集
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* 編集モーダル */}
      <Dialog open={editingRow !== null} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent className="max-w-2xl">
          {editingRow && form && (
            <>
              <DialogHeader>
                <DialogTitle>業務定義の編集</DialogTitle>
                <DialogDescription>
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        editingRow.kind === 'ASIS'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {editingRow.kind}
                    </span>
                    {editingRow.flowName}
                  </span>
                </DialogDescription>
              </DialogHeader>

              {modalError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {modalError}
                </div>
              )}

              <div className="space-y-4">
                {/* 単一行項目（2カラム）。マスタに紐づく項目は選択式（値は従来どおり文字列カラムに保存＝後方互換） */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {MODAL_TEXT_FIELDS.map((f) => {
                    const key = f.key as EditableTextKey;
                    return (
                      <div key={f.key} className="space-y-1">
                        <label className="text-xs font-semibold text-gray-600">{f.label}</label>
                        {INFO_KEYS.has(f.key) ? (
                          // INPUT/OUTPUT: 情報種別マスタから名前で選択（＋新規追加で即選択）
                          <InformationTypePicker
                            projectId={projectId}
                            informationTypes={infoTypes}
                            valueMode="name"
                            value={form[key] || null}
                            onChange={(v) => setFormField(key, v ?? '')}
                            onCreated={(created) => setInfoTypes((prev) => [...prev, created])}
                            disabled={modalSaving}
                            triggerClassName="h-9 w-full border-gray-300 bg-white text-sm text-gray-900"
                          />
                        ) : ROLE_FIELD_KEYS.has(f.key) ? (
                          // 担当・次工程: ロールマスタから選択（＋新規追加 → 再取得して即選択）
                          <MasterSelectField
                            value={form[key]}
                            options={roles.map((r) => r.name)}
                            onChange={(v) => setFormField(key, v)}
                            onCreate={createRole}
                            disabled={modalSaving}
                            createTitle="ロールを追加"
                            createPlaceholder="例: 営業担当"
                          />
                        ) : f.key === 'system' ? (
                          // システム: System マスタから選択（＋新規追加は周辺システムとして登録 → 即選択）
                          <MasterSelectField
                            value={form.system}
                            options={systems.map((s) => s.name)}
                            onChange={(v) => setFormField('system', v)}
                            onCreate={createSystem}
                            disabled={modalSaving}
                            createTitle="システムを追加"
                            createPlaceholder="例: 販売管理システム"
                          />
                        ) : (
                          <input
                            value={form[key]}
                            onChange={(e) => setFormField(f.key as keyof ModalForm, e.target.value)}
                            disabled={modalSaving}
                            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300 disabled:opacity-50"
                            placeholder="—"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* DO 手順（1行1手順） */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-600">DO手順（1行1手順）</label>
                  <Textarea
                    value={form.doSteps}
                    onChange={(e) => setFormField('doSteps', e.target.value)}
                    disabled={modalSaving}
                    rows={4}
                    placeholder={'1. 受注内容を確認する\n2. 在庫を引き当てる'}
                  />
                </div>

                {/* 複数行テキスト項目 */}
                {MODAL_TEXTAREA_FIELDS.map((f) => (
                  <div key={f.key} className="space-y-1">
                    <label className="text-xs font-semibold text-gray-600">{f.label}</label>
                    <Textarea
                      value={form[f.key as EditableTextKey]}
                      onChange={(e) => setFormField(f.key as keyof ModalForm, e.target.value)}
                      disabled={modalSaving}
                      rows={3}
                      placeholder="—"
                    />
                  </div>
                ))}

                {/* 添付（写真・スクショ）。アップロード即保存・モーダル保存とは独立 */}
                <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50/60 p-3">
                  <div className="flex items-center justify-between">
                    <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                      <Paperclip className="h-3.5 w-3.5" />
                      添付（写真・スクショ）
                    </label>
                  </div>

                  {/* ドラッグ&ドロップ（クリックでファイル選択も可）。複数可・逐次アップロード */}
                  <FileDropZone
                    onFiles={(files) => void uploadAttachments(files)}
                    accept="image/*,.pdf"
                    busy={attachmentUploading}
                    className="py-2.5"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Paperclip className="h-3.5 w-3.5 text-gray-400" />
                      写真・スクショ・PDFをドラッグ＆ドロップ、またはクリックして選択
                    </span>
                  </FileDropZone>

                  {attachmentError && (
                    <p className="flex items-center gap-1 text-xs text-red-600">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      {attachmentError}
                    </p>
                  )}

                  {attachmentsLoading ? (
                    <div className="flex items-center gap-2 py-2 text-xs text-gray-500">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      読み込み中…
                    </div>
                  ) : attachments.length === 0 ? (
                    <p className="py-1 text-xs text-gray-400">添付ファイルはまだありません。</p>
                  ) : (
                    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {attachments.map((a) => {
                        const isImage = a.kind === 'IMAGE' || a.mimeType.startsWith('image/');
                        return (
                          <li
                            key={a.id}
                            className="rounded border border-gray-200 bg-white p-1.5"
                          >
                            <a
                              href={flowAttachmentApi.fileUrl(a.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block"
                              title={a.filename}
                            >
                              {isImage ? (
                                // 画像はサムネイル表示（クリックで原寸を別タブ表示）
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={flowAttachmentApi.fileUrl(a.id)}
                                  alt={a.filename}
                                  className="h-24 w-full rounded bg-gray-100 object-cover"
                                />
                              ) : (
                                // PDF 等はファイル名リンク
                                <span className="flex h-24 w-full flex-col items-center justify-center gap-1 rounded bg-gray-50 px-2 text-center">
                                  <FileText className="h-6 w-6 text-gray-400" />
                                  <span className="line-clamp-2 break-all text-[11px] text-blue-600 underline">
                                    {a.filename}
                                  </span>
                                </span>
                              )}
                            </a>
                            <div className="mt-1 flex items-center justify-between gap-1">
                              <span
                                className="min-w-0 flex-1 truncate text-[11px] text-gray-500"
                                title={a.filename}
                              >
                                {a.filename}
                              </span>
                              <span className="shrink-0 text-[10px] text-gray-400">
                                {formatBytes(a.size)}
                              </span>
                              <button
                                type="button"
                                onClick={() => void deleteAttachment(a)}
                                className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                title="削除"
                                aria-label={`${a.filename} を削除`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeEdit}
                  disabled={modalSaving}
                  className="text-gray-700"
                >
                  キャンセル
                </Button>
                <Button type="button" onClick={saveModal} disabled={modalSaving}>
                  {modalSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  保存
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
