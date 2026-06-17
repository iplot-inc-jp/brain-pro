export type MediaKind = 'image' | 'video' | 'pdf' | 'other';

export function inferMediaKind(mimeType: string): MediaKind {
  const m = (mimeType || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m === 'application/pdf') return 'pdf';
  return 'other';
}
