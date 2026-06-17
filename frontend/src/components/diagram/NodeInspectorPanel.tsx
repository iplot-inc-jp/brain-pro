'use client';
import { useCallback, useEffect, useState } from 'react';
import { X, Trash2, Sparkles } from 'lucide-react';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import { uploadProjectFile } from '@/lib/upload';
import { nodeAttachmentApi, type DiagramNodeKind, type NodeAttachmentDto } from '@/lib/node-attachments';
import { AttachmentViewer } from './AttachmentViewer';

export interface NodeInspectorPanelProps {
  projectId: string;
  nodeKind: DiagramNodeKind;
  nodeId: string;
  nodeLabel: string;
  onClose: () => void;
}

export function NodeInspectorPanel({ projectId, nodeKind, nodeId, nodeLabel, onClose }: NodeInspectorPanelProps) {
  const [items, setItems] = useState<NodeAttachmentDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'files' | 'kg'>('files');

  const reload = useCallback(() => {
    nodeAttachmentApi.list(projectId, nodeKind, nodeId).then(setItems).catch(() => setItems([]));
  }, [projectId, nodeKind, nodeId]);
  useEffect(() => { reload(); }, [reload]);

  const onFiles = useCallback(async (files: File[]) => {
    setBusy(true);
    try {
      for (const f of files) {
        const att = await uploadProjectFile(projectId, f);
        await nodeAttachmentApi.create(projectId, { nodeKind, nodeId, attachmentId: att.id });
      }
      reload();
    } finally { setBusy(false); }
  }, [projectId, nodeKind, nodeId, reload]);

  const remove = useCallback(async (id: string) => {
    await nodeAttachmentApi.remove(id); reload();
  }, [reload]);

  return (
    <div className="absolute right-3 top-3 z-30 w-80 rounded-lg border border-gray-200 bg-white shadow-lg">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="truncate text-sm font-semibold text-gray-700">{nodeLabel}</span>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex border-b text-xs">
        <button type="button" onClick={() => setTab('files')} className={`flex-1 py-2 ${tab === 'files' ? 'border-b-2 border-blue-500 font-semibold text-blue-600' : 'text-gray-500'}`}>添付</button>
        <button type="button" onClick={() => setTab('kg')} className={`flex-1 py-2 ${tab === 'kg' ? 'border-b-2 border-blue-500 font-semibold text-blue-600' : 'text-gray-500'}`}>ナレッジグラフ</button>
      </div>
      {tab === 'files' && (
        <div className="space-y-2 p-3">
          <FileDropZone onFiles={onFiles} busy={busy} accept="image/*,video/*,application/pdf" />
          <ul className="space-y-3">
            {items.map((it) => (
              <li key={it.id} className="rounded border p-2">
                {it.attachment && <AttachmentViewer attachment={it.attachment} />}
                <div className="mt-1 flex items-center justify-between">
                  <span className="truncate text-[11px] text-gray-500">{it.attachment?.displayName || it.attachment?.filename}</span>
                  <button type="button" onClick={() => remove(it.id)} className="text-red-500 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </li>
            ))}
            {items.length === 0 && <li className="text-center text-[11px] text-gray-400">添付はまだありません</li>}
          </ul>
        </div>
      )}
      {tab === 'kg' && (
        <div className="space-y-2 p-3 text-xs text-gray-600">
          <p>添付したファイルは自動的にナレッジグラフに登録されています。下のボタンでAI抽出（$）を実行できます。</p>
          {/* For v1, AI抽出 runs per-document; reuse the document ids surfaced by the graph view, or expose them later. */}
          <button type="button" className="inline-flex items-center gap-1 rounded bg-violet-600 px-2 py-1 text-white disabled:opacity-50" disabled>
            <Sparkles className="h-3.5 w-3.5" /> AI抽出（ナレッジグラフ画面から実行）
          </button>
        </div>
      )}
    </div>
  );
}
