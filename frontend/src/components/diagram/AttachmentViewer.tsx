import { nodeAttachmentApi, type AttachmentMeta } from '@/lib/node-attachments';
import { inferMediaKind } from '@/lib/diagram-media';
import { FileText } from 'lucide-react';

export function AttachmentViewer({ attachment }: { attachment: AttachmentMeta }) {
  const url = nodeAttachmentApi.fileUrl(attachment.id);
  const kind = inferMediaKind(attachment.mimeType);
  if (kind === 'image') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={attachment.filename} className="max-h-80 w-full rounded bg-gray-100 object-contain" />;
  }
  if (kind === 'video') {
    return <video src={url} controls className="max-h-80 w-full rounded bg-black" />;
  }
  if (kind === 'pdf') {
    return <iframe src={url} title={attachment.filename} className="h-80 w-full rounded border" />;
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-blue-600 underline">
      <FileText className="h-4 w-4" /> {attachment.displayName || attachment.filename}
    </a>
  );
}
