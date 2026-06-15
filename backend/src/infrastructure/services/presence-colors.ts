/**
 * プレゼンス用カラーパレット＋ユーザーIDから決定的に色を割り当てる純関数。
 * サーバ権威（全クライアントが同じ色に一致させるため）。フロントは presence-helpers.ts でミラーする。
 */
export const PRESENCE_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899',
] as const;

export function deterministicColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % PRESENCE_COLORS.length;
  return PRESENCE_COLORS[idx];
}
