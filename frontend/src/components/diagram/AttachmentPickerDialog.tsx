'use client';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Upload,
  FolderOpen,
  Image as ImageIcon,
  FileText,
  Loader2,
} from 'lucide-react';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import { uploadProjectFile, registerBlobAttachment } from '@/lib/upload';
import {
  projectAttachmentApi,
  type ProjectAttachment,
} from '@/lib/project-attachments';
import {
  pageScreenshotApi,
  type PageScreenshot,
} from '@/lib/page-screenshots';
import { nodeAttachmentApi } from '@/lib/node-attachments';

type Source = 'upload' | 'existing' | 'screenshot';

/**
 * 添付ソース選択ダイアログ。3つの経路で Attachment を用意し、その id を onPick で返す。
 *  - アップロード: 新規ファイルを上げる（Blob 直 or サーバ経由）
 *  - 既存ファイル: プロジェクト直下の登録済み添付から選ぶ
 *  - スクリーンショット: ページ別スクショ（GitHub/アップロード）を Attachment 化して選ぶ
 * ReactFlow の transform 下で fixed が効かないため body へ portal する。
 */
export function AttachmentPickerDialog({
  projectId,
  onPick,
  onClose,
}: {
  projectId: string;
  /** 選んだ Attachment の id を返す。親がノード/エッジへ紐づける。 */
  onPick: (attachmentId: string, caption?: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [source, setSource] = useState<Source>('upload');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [existing, setExisting] = useState<ProjectAttachment[]>([]);
  const [shots, setShots] = useState<PageScreenshot[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  useEffect(() => {
    if (source === 'existing') {
      setLoadingList(true);
      projectAttachmentApi
        .list(projectId)
        .then(setExisting)
        .catch(() => setExisting([]))
        .finally(() => setLoadingList(false));
    } else if (source === 'screenshot') {
      setLoadingList(true);
      pageScreenshotApi
        .list(projectId)
        .then((r) => setShots(r.items.filter((s) => s.blobUrl)))
        .catch(() => setShots([]))
        .finally(() => setLoadingList(false));
    }
  }, [source, projectId]);

  const handleUpload = useCallback(
    async (files: File[]) => {
      setBusy(true);
      setError(null);
      try {
        for (const f of files) {
          const att = await uploadProjectFile(projectId, f);
          await onPick(att.id);
        }
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'アップロードに失敗しました');
        setBusy(false);
      }
    },
    [projectId, onPick, onClose],
  );

  const pickExisting = useCallback(
    async (att: ProjectAttachment) => {
      setBusy(true);
      setError(null);
      try {
        await onPick(att.id, att.caption ?? undefined);
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : '添付に失敗しました');
        setBusy(false);
      }
    },
    [onPick, onClose],
  );

  const pickScreenshot = useCallback(
    async (s: PageScreenshot) => {
      if (!s.blobUrl) return;
      setBusy(true);
      setError(null);
      try {
        const att = await registerBlobAttachment(projectId, {
          blobUrl: s.blobUrl,
          filename: s.caption || s.slug || 'screenshot',
          mimeType: s.mimeType || 'image/png',
        });
        await onPick(att.id, s.caption || undefined);
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : '添付に失敗しました');
        setBusy(false);
      }
    },
    [projectId, onPick, onClose],
  );

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-800">ファイル・画像を選択</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex border-b text-sm">
          {(
            [
              { key: 'upload', label: 'アップロード', icon: Upload },
              { key: 'existing', label: '既存ファイル', icon: FolderOpen },
              { key: 'screenshot', label: 'スクリーンショット', icon: ImageIcon },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSource(t.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 ${
                source === t.key
                  ? 'border-b-2 border-blue-500 font-semibold text-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>
        {error && (
          <div className="border-b bg-red-50 px-4 py-2 text-xs text-red-600">{error}</div>
        )}
        <div className="flex-1 overflow-y-auto p-4">
          {source === 'upload' && (
            <FileDropZone
              onFiles={handleUpload}
              busy={busy}
              accept="image/*,video/*,application/pdf"
              multiple
            />
          )}
          {source === 'existing' &&
            (loadingList ? (
              <ListLoading />
            ) : existing.length === 0 ? (
              <Empty text="プロジェクトに登録済みのファイルがありません" />
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {existing.map((a) => (
                  <PickTile
                    key={a.id}
                    url={nodeAttachmentApi.fileUrl(a.id)}
                    isImage={a.kind === 'IMAGE'}
                    label={a.displayName || a.filename}
                    disabled={busy}
                    onClick={() => pickExisting(a)}
                  />
                ))}
              </div>
            ))}
          {source === 'screenshot' &&
            (loadingList ? (
              <ListLoading />
            ) : shots.length === 0 ? (
              <Empty text="スクリーンショットがありません（GitHub取り込み/アップロードで追加）" />
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {shots.map((s) => (
                  <PickTile
                    key={s.id}
                    url={s.blobUrl!}
                    isImage
                    label={s.caption || s.slug}
                    disabled={busy}
                    onClick={() => pickScreenshot(s)}
                  />
                ))}
              </div>
            ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ListLoading() {
  return (
    <div className="flex justify-center py-10">
      <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-10 text-center text-sm text-gray-400">{text}</p>;
}

function PickTile({
  url,
  isImage,
  label,
  disabled,
  onClick,
}: {
  url: string;
  isImage: boolean;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="group flex flex-col overflow-hidden rounded-lg border border-gray-200 text-left hover:border-blue-400 hover:ring-1 hover:ring-blue-300 disabled:opacity-50"
    >
      <div className="flex aspect-square items-center justify-center bg-gray-50">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <FileText className="h-7 w-7 text-gray-400" />
        )}
      </div>
      <span className="truncate px-1.5 py-1 text-[11px] text-gray-600">{label}</span>
    </button>
  );
}
