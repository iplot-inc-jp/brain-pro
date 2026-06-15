/** room id 規約。backend の `project:${projectId}` と一致させる。 */
export function roomIdForProject(projectId: string): string {
  return `project:${projectId}`;
}
export function projectIdFromRoom(room: string): string {
  return room.replace(/^project:/, '');
}

/** バックエンド presence-colors.ts のミラー（フォールバック描画用）。色の真実源は backend。 */
export const PRESENCE_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899',
] as const;

type CursorPresence = { presence: { cursor: { x: number; y: number } | null; page: string } };
/** 同一サブページかつ cursor 非 null のピアだけ描画する。 */
export function shouldShowCursor(other: CursorPresence, myPage: string): boolean {
  return !!other.presence.cursor && other.presence.page === myPage;
}

/** 同一 user.id の重複（複数タブ）を最初の1件に畳む。 */
export function dedupeByUserId<T extends { id: string }>(users: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const u of users) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    out.push(u);
  }
  return out;
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

export function displayName(info: { name?: string | null; email?: string | null }): string {
  if (info.name && info.name.trim()) return info.name.trim();
  if (info.email && info.email.includes('@')) return info.email.split('@')[0]!;
  if (info.email && info.email.trim()) return info.email.trim();
  return '匿名';
}
