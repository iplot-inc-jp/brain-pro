'use client';

/**
 * INPUT/OUTPUT 行の「具体データ（添付）」パネル。
 *
 * - 添付をフォルダごとのアコーディオンでグルーピング表示（folder=null は「未分類」）
 * - 表示名（displayName || filename）のインライン編集（鉛筆 → input → blur/Enter で保存）
 * - フォルダ移動（既存フォルダ名の select ＋「新しいフォルダ…」で自由入力）
 * - アップロード時に振り分け先フォルダを指定可能
 *
 * フォルダ候補は専用マスタを持たず、プロジェクト内で観測した既存 folder 値
 * （親ページが各行から収集）から構成する。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Link2,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import {
  informationTypeApi,
  isLinkAttachment,
  isDriveFolderLink,
  attachmentHref,
  type InformationTypeAttachment,
} from '@/lib/dfd';
import { uploadProjectFile } from '@/lib/upload';

/** 「新しいフォルダ…」選択肢の内部値（実フォルダ名と衝突しない sentinel）。 */
const NEW_FOLDER_VALUE = '__new_folder__';
/** 未分類（folder=null）グループの内部キー。 */
const UNFILED_KEY = '';

/** 添付が画像かどうか（サムネイル表示するか）。 */
function isImageAttachment(a: InformationTypeAttachment): boolean {
  return a.kind === 'IMAGE' || a.mimeType.startsWith('image/');
}

/** 表示名（編集可能。未設定ならファイル名）。 */
function attachmentLabel(a: InformationTypeAttachment): string {
  return a.displayName || a.filename;
}

/**
 * フォルダ選択 select。既存フォルダ候補＋現在値＋「新しいフォルダ…」（prompt で自由入力）。
 * value=null は「未分類」。
 */
function FolderSelect({
  value,
  candidates,
  onSelect,
  disabled,
  className,
  title,
}: {
  value: string | null;
  candidates: string[];
  onSelect: (folder: string | null) => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  // 候補に現在値が含まれない場合（移動直後など）も表示できるようマージ
  const options = useMemo(() => {
    const set = new Set(candidates);
    if (value) set.add(value);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ja'));
  }, [candidates, value]);

  return (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value;
        if (v === NEW_FOLDER_VALUE) {
          const name = window.prompt('新しいフォルダ名を入力してください');
          const trimmed = name?.trim();
          // キャンセル・空入力時は何もしない（controlled なので表示は元の値に戻る）
          if (trimmed) onSelect(trimmed);
          return;
        }
        onSelect(v || null);
      }}
      className={`rounded border border-gray-200 bg-white px-1 py-0.5 text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-40 ${className ?? 'text-[11px]'}`}
      title={title ?? 'フォルダ'}
    >
      <option value="">未分類</option>
      {options.map((f) => (
        <option key={f} value={f}>
          {f}
        </option>
      ))}
      <option value={NEW_FOLDER_VALUE}>＋ 新しいフォルダ…</option>
    </select>
  );
}

/**
 * 表示名のインライン編集。鉛筆クリックで input に切替、blur/Enter で保存、Escape で取消。
 * link 指定時は閲覧モードの名前をファイルへのリンク（新タブ）として表示。
 */
function EditableName({
  att,
  link,
  onSave,
  textClassName,
}: {
  att: InformationTypeAttachment;
  link?: string;
  onSave: (displayName: string | null) => void;
  textClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const cancelRef = useRef(false);
  const label = attachmentLabel(att);
  const sizeClass = textClassName ?? 'text-xs';

  if (editing) {
    return (
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        placeholder={att.filename}
        onBlur={() => {
          setEditing(false);
          if (cancelRef.current) {
            cancelRef.current = false;
            return;
          }
          const next = draft.trim() || null; // 空は null（= filename 表示に戻る）
          if (next !== att.displayName) onSave(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            cancelRef.current = true;
            e.currentTarget.blur();
          }
        }}
        className={`min-w-0 flex-1 rounded border border-blue-300 bg-white px-1 py-0.5 text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400 ${sizeClass}`}
      />
    );
  }

  return (
    <>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className={`min-w-0 flex-1 truncate text-blue-600 hover:underline ${sizeClass}`}
          title={`${label}（新タブで開く）`}
        >
          {label}
        </a>
      ) : (
        <span className={`min-w-0 flex-1 truncate text-gray-600 ${sizeClass}`} title={label}>
          {label}
        </span>
      )}
      <button
        type="button"
        onClick={() => {
          setDraft(att.displayName ?? '');
          cancelRef.current = false;
          setEditing(true);
        }}
        className="shrink-0 text-gray-300 hover:text-blue-600"
        title="表示名を編集"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </>
  );
}

/** 画像添付のサムネイルカード（プレビュー＋表示名編集＋フォルダ移動＋削除）。 */
function ImageAttachmentCard({
  att,
  folderCandidates,
  onRename,
  onMove,
  onDelete,
}: {
  att: InformationTypeAttachment;
  folderCandidates: string[];
  onRename: (displayName: string | null) => void;
  onMove: (folder: string | null) => void;
  onDelete: () => void;
}) {
  const label = attachmentLabel(att);
  return (
    <div className="w-24 space-y-0.5">
      <div className="group relative">
        <a
          href={informationTypeApi.fileUrl(att.id)}
          target="_blank"
          rel="noreferrer"
          title={`${label}（クリックで原寸表示）`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={informationTypeApi.fileUrl(att.id)}
            alt={label}
            className="h-20 w-24 rounded border border-gray-200 bg-white object-cover"
          />
        </a>
        <button
          type="button"
          onClick={onDelete}
          className="absolute -right-1.5 -top-1.5 hidden rounded-full border border-gray-200 bg-white p-0.5 text-gray-400 shadow-sm hover:text-red-600 group-hover:block"
          title="この添付を削除"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <div className="flex items-center gap-0.5">
        <EditableName att={att} onSave={onRename} textClassName="text-[10px]" />
      </div>
      <FolderSelect
        value={att.folder}
        candidates={folderCandidates}
        onSelect={onMove}
        className="w-full text-[10px]"
        title="フォルダ移動"
      />
    </div>
  );
}

/** PDF / その他ファイルの行（リンク＋表示名編集＋フォルダ移動＋削除）。 */
function FileAttachmentRow({
  att,
  folderCandidates,
  onRename,
  onMove,
  onDelete,
}: {
  att: InformationTypeAttachment;
  folderCandidates: string[];
  onRename: (displayName: string | null) => void;
  onMove: (folder: string | null) => void;
  onDelete: () => void;
}) {
  const link = isLinkAttachment(att);
  const isFolder = link && isDriveFolderLink(att.url);
  const Icon = isFolder ? FolderOpen : link ? Link2 : FileText;
  const iconClass = isFolder
    ? 'text-amber-500'
    : link
      ? 'text-sky-500'
      : 'text-gray-400';
  return (
    <li className="flex items-center gap-2 rounded border border-gray-100 bg-white px-2 py-1 text-xs">
      <Icon className={`h-3.5 w-3.5 shrink-0 ${iconClass}`} />
      <EditableName att={att} link={attachmentHref(att)} onSave={onRename} />
      <FolderSelect
        value={att.folder}
        candidates={folderCandidates}
        onSelect={onMove}
        className="max-w-[9rem] text-[11px]"
        title="フォルダ移動"
      />
      <button
        type="button"
        onClick={onDelete}
        className="shrink-0 text-gray-400 hover:text-red-600"
        title="この添付を削除"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

export function IoAttachmentsPanel({
  projectId,
  informationTypeId,
  expanded,
  folderCandidates,
  onFoldersSeen,
  onCountChange,
}: {
  projectId: string;
  informationTypeId: string;
  /** 行が展開されているか。false の間は描画しない（取得済みの状態は保持）。 */
  expanded: boolean;
  /** プロジェクト内で観測済みのフォルダ名候補（親ページが収集）。 */
  folderCandidates: string[];
  /** 新たに観測したフォルダ名を親へ報告（候補のマージ用）。 */
  onFoldersSeen: (folders: string[]) => void;
  /** 件数バッジ更新用。 */
  onCountChange: (count: number) => void;
}) {
  const [attachments, setAttachments] = useState<InformationTypeAttachment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  /** アップロード時の振り分け先フォルダ（null = 未分類）。リンク追加でも共用。 */
  const [uploadFolder, setUploadFolder] = useState<string | null>(null);
  /** Driveリンク/URL 追加フォームの入力。 */
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');
  const [addingLink, setAddingLink] = useState(false);
  /** 折りたたんだフォルダグループ（キーはフォルダ名。未分類は ''）。既定は全展開。 */
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  /** 一覧を state に反映し、件数とフォルダ候補を親へ報告。 */
  const applyList = useCallback(
    (list: InformationTypeAttachment[]) => {
      setAttachments(list);
      onCountChange(list.length);
      const folders = list.map((a) => a.folder).filter((f): f is string => !!f);
      if (folders.length > 0) onFoldersSeen(folders);
    },
    [onCountChange, onFoldersSeen],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await informationTypeApi.listAttachments(informationTypeId);
      applyList(list);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [informationTypeId, applyList]);

  // 展開時に一覧を取得（初回のみ。アップロード/削除後は handlers 側で再取得）
  useEffect(() => {
    if (expanded && !loaded) void load();
  }, [expanded, loaded, load]);

  const handleUpload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      setError(null);
      const failed: string[] = [];
      // 逐次アップロード（multipart）。失敗したものはまとめてインライン表示。
      for (const file of files) {
        try {
          // 共有プール: client直Blob（大ファイル可）→ 失敗/未設定時は従来のio-types添付(4MB)へフォールバック。
          const created = await uploadProjectFile(
            projectId,
            file,
            { informationTypeId, folder: uploadFolder || undefined },
            (_p, f) => informationTypeApi.upload(informationTypeId, f),
          );
          if (uploadFolder) {
            // フォールバック経路はフォルダ未設定のため、直後にメタ更新で振り分ける（client直は scope で設定済み）
            try {
              await informationTypeApi.updateAttachment(created.id, { folder: uploadFolder });
            } catch {
              // 振り分け失敗時は未分類のまま（本体のアップロードは成功扱い）
            }
          }
        } catch {
          failed.push(file.name);
        }
      }
      // load は error をクリアするので、失敗メッセージは再取得後に設定する
      await load();
      if (failed.length > 0) {
        setError(`アップロードに失敗しました: ${failed.join('、')}`);
      }
      setUploading(false);
    },
    [informationTypeId, uploadFolder, load],
  );

  const handleAddLink = useCallback(async () => {
    const url = linkUrl.trim();
    if (!url) return;
    setAddingLink(true);
    setError(null);
    try {
      await informationTypeApi.addLink(informationTypeId, {
        url,
        displayName: linkName.trim() || undefined,
        folder: uploadFolder || undefined,
      });
      setLinkUrl('');
      setLinkName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setAddingLink(false);
    }
  }, [linkUrl, linkName, uploadFolder, informationTypeId, load]);

  const handleDelete = useCallback(
    async (att: InformationTypeAttachment) => {
      if (!confirm(`添付「${attachmentLabel(att)}」を削除しますか？`)) return;
      setError(null);
      try {
        await informationTypeApi.deleteAttachment(att.id);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    },
    [load],
  );

  /** メタ情報（表示名・フォルダ）を更新し、レスポンスでローカル state を差し替える。 */
  const patchAttachment = useCallback(
    async (att: InformationTypeAttachment, patch: { displayName?: string | null; folder?: string | null }) => {
      setError(null);
      try {
        const updated = await informationTypeApi.updateAttachment(att.id, patch);
        setAttachments((prev) => prev.map((a) => (a.id === att.id ? { ...a, ...updated } : a)));
        if (updated.folder) onFoldersSeen([updated.folder]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    },
    [onFoldersSeen],
  );

  const handleMove = useCallback(
    (att: InformationTypeAttachment, folder: string | null) => {
      if (folder === att.folder) return;
      void patchAttachment(att, { folder });
    },
    [patchAttachment],
  );

  const handleRename = useCallback(
    (att: InformationTypeAttachment, displayName: string | null) => {
      void patchAttachment(att, { displayName });
    },
    [patchAttachment],
  );

  /** フォルダごとのグループ。名前付きフォルダを五十音順、未分類は最後。 */
  const groups = useMemo(() => {
    const map = new Map<string, InformationTypeAttachment[]>();
    for (const a of attachments) {
      const key = a.folder ?? UNFILED_KEY;
      const arr = map.get(key) ?? [];
      arr.push(a);
      map.set(key, arr);
    }
    const named = Array.from(map.keys())
      .filter((k) => k !== UNFILED_KEY)
      .sort((a, b) => a.localeCompare(b, 'ja'));
    const keys = map.has(UNFILED_KEY) ? [...named, UNFILED_KEY] : named;
    return keys.map((key) => ({
      key,
      name: key === UNFILED_KEY ? null : key,
      items: map.get(key)!,
    }));
  }, [attachments]);

  const toggleFolder = useCallback((key: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  if (!expanded) return null;

  return (
    <div className="mt-2 space-y-2 rounded border border-gray-100 bg-gray-50/60 p-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500">
          <Paperclip className="h-3 w-3" />
          具体データ（PDF・画像・Driveリンク）
        </span>
      </div>

      {/* アップロード行: ドロップゾーン + 振り分け先フォルダ */}
      <div className="flex items-stretch gap-2">
        <FileDropZone
          onFiles={(files) => void handleUpload(files)}
          accept="image/*,.pdf"
          busy={uploading}
          className="flex-1 py-2.5"
        >
          <span className="inline-flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5 text-gray-400" />
            PDF・画像をドラッグ＆ドロップ、またはクリックして選択
          </span>
        </FileDropZone>
        <label className="flex shrink-0 flex-col justify-center gap-0.5">
          <span className="text-[10px] text-gray-400">追加先フォルダ</span>
          <FolderSelect
            value={uploadFolder}
            candidates={folderCandidates}
            onSelect={setUploadFolder}
            disabled={uploading || addingLink}
            className="text-[11px]"
            title="追加先フォルダ（アップロード・リンク共通）"
          />
        </label>
      </div>

      {/* Driveリンク/URL の追加（ファイル・フォルダどちらも可） */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[15rem] flex-1 items-center gap-1.5 rounded border border-gray-200 bg-white px-2 py-1.5">
          <Link2 className="h-3.5 w-3.5 shrink-0 text-sky-500" />
          <input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleAddLink();
            }}
            placeholder="Google Drive等のURL（フォルダも可）を貼り付け"
            className="w-full bg-transparent text-xs text-gray-800 outline-none placeholder:text-gray-400"
          />
        </div>
        <input
          value={linkName}
          onChange={(e) => setLinkName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleAddLink();
          }}
          placeholder="表示名（任意）"
          className="w-32 rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800 outline-none placeholder:text-gray-400"
        />
        <button
          type="button"
          onClick={() => void handleAddLink()}
          disabled={addingLink || !linkUrl.trim()}
          className="inline-flex shrink-0 items-center gap-1 rounded bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {addingLink ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          リンク追加
        </button>
      </div>

      {error && <p className="text-[11px] text-red-600">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
        </div>
      ) : attachments.length === 0 ? (
        <p className="py-2 text-xs text-gray-400">
          まだ具体データがありません。請求書のPDFや帳票のスクリーンショットを複数添付したり、Google Drive のファイル/フォルダのリンクを紐付けられます
        </p>
      ) : (
        <div className="space-y-1.5">
          {groups.map((g) => {
            const open = !collapsedFolders.has(g.key);
            const images = g.items.filter(isImageAttachment);
            const files = g.items.filter((a) => !isImageAttachment(a));
            return (
              <div key={g.key} className="rounded border border-gray-200 bg-white">
                <button
                  type="button"
                  onClick={() => toggleFolder(g.key)}
                  className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-gray-50"
                  title={open ? 'フォルダを閉じる' : 'フォルダを開く'}
                >
                  {open ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  )}
                  {open ? (
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  ) : (
                    <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  )}
                  <span
                    className={`min-w-0 truncate text-xs font-medium ${g.name ? 'text-gray-700' : 'text-gray-400'}`}
                  >
                    {g.name ?? '未分類'}
                  </span>
                  <span className="text-[10px] tabular-nums text-gray-400">{g.items.length}件</span>
                </button>

                {open && (
                  <div className="space-y-2 border-t border-gray-100 p-2">
                    {/* 画像: サムネイルグリッド（クリックで原寸を新タブ表示） */}
                    {images.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {images.map((a) => (
                          <ImageAttachmentCard
                            key={a.id}
                            att={a}
                            folderCandidates={folderCandidates}
                            onRename={(v) => handleRename(a, v)}
                            onMove={(f) => handleMove(a, f)}
                            onDelete={() => void handleDelete(a)}
                          />
                        ))}
                      </div>
                    )}

                    {/* PDF / その他: ファイル名リンク（新タブ） */}
                    {files.length > 0 && (
                      <ul className="space-y-1">
                        {files.map((a) => (
                          <FileAttachmentRow
                            key={a.id}
                            att={a}
                            folderCandidates={folderCandidates}
                            onRename={(v) => handleRename(a, v)}
                            onMove={(f) => handleMove(a, f)}
                            onDelete={() => void handleDelete(a)}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
