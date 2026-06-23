'use client';
import { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, FileText, ExternalLink } from 'lucide-react';
import { nodeAttachmentApi } from '@/lib/node-attachments';
import { inferMediaKind } from '@/lib/diagram-media';

export interface LightboxItem {
  attachmentId: string;
  mimeType: string;
  filename: string;
  caption?: string | null;
}

/**
 * 添付（画像 / 動画 / PDF / その他）の全画面プレビュアー。
 * 左右キー・ボタンで前後送り、Esc / 背景クリックで閉じる。
 * ReactFlow の transform 下では position:fixed が効かないため body へ portal する。
 */
export function AttachmentLightbox({
  items,
  index,
  onIndexChange,
  onClose,
}: {
  items: LightboxItem[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const count = items.length;
  const go = useCallback(
    (d: -1 | 1) => {
      if (count === 0) return;
      onIndexChange((index + d + count) % count);
    },
    [index, count, onIndexChange],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  if (typeof document === 'undefined' || count === 0) return null;
  const item = items[Math.max(0, Math.min(index, count - 1))];
  const url = nodeAttachmentApi.fileUrl(item.attachmentId);
  const kind = inferMediaKind(item.mimeType);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <span className="truncate text-sm">
          {item.caption || item.filename}
          {count > 1 && (
            <span className="ml-2 text-white/60">
              {index + 1} / {count}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="rounded p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
            title="新しいタブで開く"
          >
            <ExternalLink className="h-5 w-5" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
            title="閉じる (Esc)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden px-4 pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        {count > 1 && (
          <button
            type="button"
            onClick={() => go(-1)}
            className="absolute left-3 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            title="前へ (←)"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={item.filename} className="max-h-full max-w-full object-contain" />
        ) : kind === 'video' ? (
          <video src={url} controls autoPlay className="max-h-full max-w-full" />
        ) : kind === 'pdf' ? (
          <iframe src={url} title={item.filename} className="h-full w-full rounded bg-white" />
        ) : (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded bg-white/10 px-4 py-3 text-white"
          >
            <FileText className="h-5 w-5" /> {item.filename}
          </a>
        )}
        {count > 1 && (
          <button
            type="button"
            onClick={() => go(1)}
            className="absolute right-3 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            title="次へ (→)"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
