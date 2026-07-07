'use client';

/**
 * ユーザー/担当者アバター。
 * - avatarUrl があればその画像を丸く表示。
 * - なければ名前から決定的な色を選び、頭文字（先頭1文字）を白抜きで表示する。
 * - 名前が空なら中立のプレースホルダ（"?"）。
 *
 * 担当者は名前文字列で保持しているため、name から表示できるよう name ベース。
 * 同じ名前は常に同じ色になるので、縦一覧でも視認で人を判別できる。
 */

/** アバター背景に使う落ち着いた配色パレット。 */
const AVATAR_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#10b981', // emerald
  '#14b8a6', // teal
  '#0ea5e9', // sky
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#d946ef', // fuchsia
  '#ec4899', // pink
  '#64748b', // slate
];

/** 文字列から決定的にパレットの色を選ぶ（同じ名前＝同じ色）。 */
export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}

/** 頭文字（先頭1文字。サロゲートペア/絵文字も1文字として扱う）。 */
export function avatarInitial(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  return Array.from(trimmed)[0].toUpperCase();
}

export function UserAvatar({
  name,
  avatarUrl,
  size = 24,
  className = '',
  title,
}: {
  name?: string | null;
  avatarUrl?: string | null;
  /** 直径(px)。 */
  size?: number;
  className?: string;
  /** ホバー時のツールチップ（未指定なら name）。 */
  title?: string;
}) {
  const tip = title ?? name ?? undefined;

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name ?? ''}
        title={tip}
        width={size}
        height={size}
        className={`shrink-0 rounded-full border border-black/5 object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  const initial = avatarInitial(name);
  const bg = avatarColor((name ?? '').trim() || '?');
  return (
    <span
      title={tip}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none text-white ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.44),
        backgroundColor: bg,
      }}
      aria-label={name ?? undefined}
    >
      {initial}
    </span>
  );
}
