'use client';

/**
 * InformationTypeRegistry — 情報種別レジストリ。
 *
 * プロジェクトの情報種別（情報/物体/帳票）を CRUD し、各種別に具体帳票ファイルを
 * アップロード / ダウンロード / 削除する。DFD のデータフローは
 * informationTypeId でこの種別を参照する（DfdCanvas / DataFlowTable）。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  FileText,
  Plus,
  Trash2,
  Upload,
  Download,
  Loader2,
  Pencil,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Paperclip,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import {
  informationTypeApi,
  INFORMATION_CATEGORY_LABELS,
  INFORMATION_CATEGORY_OPTIONS,
  type InformationType,
  type InformationCategory,
  type InformationTypeAttachment,
} from '@/lib/dfd';

export interface InformationTypeRegistryProps {
  projectId: string;
  /** 親に最新の一覧を通知（DfdCanvas / DataFlowTable で名前参照するため） */
  onInformationTypesChange?: (informationTypes: InformationType[]) => void;
}

/** 分類バッジ（情報/物体/帳票）。 */
function CategoryBadge({ category }: { category: InformationCategory }) {
  const styles: Record<InformationCategory, string> = {
    INFORMATION: 'border-blue-200 bg-blue-50 text-blue-700',
    OBJECT: 'border-amber-200 bg-amber-50 text-amber-700',
    DOCUMENT: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  };
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${styles[category]}`}>
      {INFORMATION_CATEGORY_LABELS[category]}
    </span>
  );
}

export function InformationTypeRegistry({ projectId, onInformationTypesChange }: InformationTypeRegistryProps) {
  const [informationTypes, setInformationTypes] = useState<InformationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<InformationCategory>('INFORMATION');
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const notify = onInformationTypesChange;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await informationTypeApi.list(projectId);
      setInformationTypes(list);
      notify?.(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [projectId, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await informationTypeApi.create(projectId, { name, category: newCategory });
      setNewName('');
      setNewCategory('INFORMATION');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setCreating(false);
    }
  }, [newName, newCategory, projectId, load]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
        <FileText className="h-4 w-4 text-emerald-600" />
        <h3 className="text-sm font-semibold text-gray-800">情報種別</h3>
        <span className="text-xs text-gray-400">
          データフローが参照する情報・物体・帳票の種別と具体帳票ファイル
        </span>
      </div>

      <div className="p-4 space-y-3">
        {/* 追加フォーム */}
        <div className="flex items-center gap-2">
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as InformationCategory)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
            title="分類"
          >
            {INFORMATION_CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate();
            }}
            placeholder="情報種別名（例：受注書）"
            className="flex-1 rounded border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <Button size="sm" onClick={() => void handleCreate()} disabled={creating || !newName.trim()}>
            {creating ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
            追加
          </Button>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          </div>
        ) : informationTypes.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">
            情報種別がありません。上のフォームから追加してください。
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded border border-gray-100">
            {informationTypes.map((it) => (
              <InformationTypeRow
                key={it.id}
                informationType={it}
                expanded={expanded === it.id}
                onToggle={() => setExpanded((cur) => (cur === it.id ? null : it.id))}
                onChanged={load}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function InformationTypeRow({
  informationType,
  expanded,
  onToggle,
  onChanged,
}: {
  informationType: InformationType;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(informationType.name);
  const [category, setCategory] = useState<InformationCategory>(informationType.category);
  const [attachments, setAttachments] = useState<InformationTypeAttachment[]>([]);
  const [attLoading, setAttLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadAttachments = useCallback(async () => {
    setAttLoading(true);
    try {
      setAttachments(await informationTypeApi.listAttachments(informationType.id));
    } catch {
      /* 一覧失敗は無視 */
    } finally {
      setAttLoading(false);
    }
  }, [informationType.id]);

  useEffect(() => {
    if (expanded) void loadAttachments();
  }, [expanded, loadAttachments]);

  const startEditing = useCallback(() => {
    setName(informationType.name);
    setCategory(informationType.category);
    setEditing(true);
  }, [informationType.name, informationType.category]);

  const handleSave = useCallback(async () => {
    const v = name.trim();
    setEditing(false);
    const nameChanged = v && v !== informationType.name;
    const categoryChanged = category !== informationType.category;
    if (!v || (!nameChanged && !categoryChanged)) {
      setName(informationType.name);
      setCategory(informationType.category);
      return;
    }
    setBusy(true);
    try {
      await informationTypeApi.update(informationType.id, { name: v, category });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }, [name, category, informationType.id, informationType.name, informationType.category, onChanged]);

  const handleDelete = useCallback(async () => {
    if (!confirm(`情報種別「${informationType.name}」を削除しますか？（具体帳票も削除されます）`)) return;
    setBusy(true);
    try {
      await informationTypeApi.delete(informationType.id);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }, [informationType.id, informationType.name, onChanged]);

  const handleUpload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      setUploadError(null);
      const failed: string[] = [];
      // 逐次アップロード。失敗したものはまとめてインライン表示。
      for (const file of files) {
        try {
          await informationTypeApi.upload(informationType.id, file);
        } catch {
          failed.push(file.name);
        }
      }
      await loadAttachments();
      await onChanged();
      if (failed.length > 0) {
        setUploadError(`アップロードに失敗しました: ${failed.join('、')}`);
      }
      setUploading(false);
    },
    [informationType.id, loadAttachments, onChanged],
  );

  const handleDeleteAttachment = useCallback(
    async (attachmentId: string) => {
      setBusy(true);
      try {
        await informationTypeApi.deleteAttachment(attachmentId);
        await loadAttachments();
        await onChanged();
      } finally {
        setBusy(false);
      }
    },
    [loadAttachments, onChanged],
  );

  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          className="text-gray-400 hover:text-gray-600"
          title="具体帳票を表示"
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        {editing ? (
          <>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as InformationCategory)}
              className="rounded border border-gray-300 px-1.5 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
              title="分類"
            >
              {INFORMATION_CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSave();
                if (e.key === 'Escape') {
                  setName(informationType.name);
                  setCategory(informationType.category);
                  setEditing(false);
                }
              }}
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <button type="button" onClick={() => void handleSave()} className="text-emerald-600 hover:text-emerald-700">
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setName(informationType.name);
                setCategory(informationType.category);
                setEditing(false);
              }}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <CategoryBadge category={informationType.category} />
            <span className="flex-1 text-sm font-medium text-gray-800">{informationType.name}</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
              <Paperclip className="h-3 w-3" />
              {informationType.attachmentCount}
            </span>
            <button
              type="button"
              onClick={startEditing}
              className="text-gray-400 hover:text-blue-600"
              title="名称・分類を編集"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={busy}
              className="text-gray-400 hover:text-red-600 disabled:opacity-40"
              title="削除"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      {expanded && (
        <div className="mt-2 ml-6 space-y-2">
          {/* ドラッグ&ドロップ（クリックでファイル選択も可）。複数可・逐次アップロード */}
          <FileDropZone
            onFiles={(files) => void handleUpload(files)}
            busy={uploading}
            className="py-2.5"
          >
            <span className="inline-flex items-center gap-1.5">
              <Upload className="h-3.5 w-3.5 text-gray-400" />
              具体帳票をドラッグ＆ドロップ、またはクリックして選択
            </span>
          </FileDropZone>

          {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}

          {attLoading ? (
            <div className="py-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            </div>
          ) : attachments.length === 0 ? (
            <p className="text-xs text-gray-400">具体帳票はまだありません。</p>
          ) : (
            <ul className="space-y-1">
              {attachments.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-1 text-xs"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <span className="flex-1 truncate text-gray-700">{a.filename}</span>
                  <a
                    href={informationTypeApi.fileUrl(a.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-blue-600 hover:underline"
                    title="ダウンロード / 表示"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => void handleDeleteAttachment(a.id)}
                    disabled={busy}
                    className="text-gray-400 hover:text-red-600 disabled:opacity-40"
                    title="この具体帳票を削除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
