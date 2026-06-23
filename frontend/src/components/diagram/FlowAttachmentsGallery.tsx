'use client';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Image as ImageIcon, FileText } from 'lucide-react';
import { nodeAttachmentApi } from '@/lib/node-attachments';
import { inferMediaKind } from '@/lib/diagram-media';
import { AttachmentLightbox, type LightboxItem } from './AttachmentLightbox';

type SourceKind = 'FLOW_NODE' | 'FLOW_EDGE';

interface GalleryEntry {
  attachmentId: string;
  mimeType: string;
  filename: string;
  sourceLabel: string;
  sourceKind: SourceKind;
}

/**
 * 業務フロー1本に紐づく全添付（ノード＋矢印）を集約して見せるギャラリー。
 * 各ノード/矢印ごとの node-attachments を並列取得して一覧化し、クリックで全画面プレビュー。
 * body へ portal（ReactFlow の transform 配下では fixed が効かないため）。
 */
export function FlowAttachmentsGallery({
  projectId,
  nodes,
  edges,
  onClose,
}: {
  projectId: string;
  nodes: { id: string; label: string }[];
  edges: { id: string; label: string }[];
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<GalleryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refs: { id: string; label: string; kind: SourceKind }[] = [
      ...nodes.map((n) => ({ id: n.id, label: n.label, kind: 'FLOW_NODE' as const })),
      ...edges.map((e) => ({ id: e.id, label: e.label, kind: 'FLOW_EDGE' as const })),
    ];
    setLoading(true);
    Promise.all(
      refs.map((r) =>
        nodeAttachmentApi
          .list(projectId, r.kind, r.id)
          .then((items) => items.map((it) => ({ ref: r, it })))
          .catch(() => []),
      ),
    )
      .then((all) => {
        if (cancelled) return;
        const flat = all.flat().filter((x) => x.it.attachment);
        setEntries(
          flat.map(({ ref, it }) => ({
            attachmentId: it.attachment!.id,
            mimeType: it.attachment!.mimeType,
            filename: it.attachment!.displayName || it.attachment!.filename,
            sourceLabel:
              ref.label || (ref.kind === 'FLOW_EDGE' ? '矢印' : 'ノード'),
            sourceKind: ref.kind,
          })),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, nodes, edges]);

  const lightboxItems = useMemo<LightboxItem[]>(
    () =>
      entries.map((e) => ({
        attachmentId: e.attachmentId,
        mimeType: e.mimeType,
        filename: e.filename,
        caption: `${e.sourceLabel}：${e.filename}`,
      })),
    [entries],
  );

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <ImageIcon className="h-4 w-4 text-blue-600" />
            このフローに紐づく画像・ファイル
            {!loading && (
              <span className="text-xs font-normal text-gray-400">{entries.length}件</span>
            )}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-7 w-7 animate-spin text-blue-500" />
            </div>
          ) : entries.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-400">
              まだ画像・ファイルが添付されていません（ノードや矢印を選んで「添付」から追加できます）
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {entries.map((e, i) => {
                const isImage = inferMediaKind(e.mimeType) === 'image';
                return (
                  <button
                    key={`${e.attachmentId}-${i}`}
                    type="button"
                    onClick={() => setLightboxIndex(i)}
                    title={`${e.sourceLabel}：${e.filename}`}
                    className="group flex flex-col overflow-hidden rounded-lg border border-gray-200 text-left hover:border-blue-400 hover:ring-1 hover:ring-blue-300"
                  >
                    <div className="flex aspect-video items-center justify-center bg-gray-50">
                      {isImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={nodeAttachmentApi.fileUrl(e.attachmentId)}
                          alt={e.filename}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <FileText className="h-7 w-7 text-gray-400" />
                      )}
                    </div>
                    <div className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <span
                          className={`rounded px-1 text-[9px] font-medium ${
                            e.sourceKind === 'FLOW_EDGE'
                              ? 'bg-violet-100 text-violet-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {e.sourceKind === 'FLOW_EDGE' ? '矢印' : 'ノード'}
                        </span>
                        <span className="truncate text-[11px] text-gray-600">
                          {e.sourceLabel}
                        </span>
                      </div>
                      <span className="mt-0.5 block truncate text-[10px] text-gray-400">
                        {e.filename}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {lightboxIndex !== null && lightboxItems.length > 0 && (
        <AttachmentLightbox
          items={lightboxItems}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>,
    document.body,
  );
}
