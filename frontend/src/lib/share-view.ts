// 共有リンク閲覧ページ（/share/**）共通のフェッチヘルパー。
//
// - ログイン済みなら Authorization を付ける（scope=ORG のリンクに必要。
//   PUBLIC リンクでは付いていても無視される）。
// - 401: 組織メンバー限定リンクに未ログインでアクセス → ログイン誘導
// - 403: 別組織のユーザー → 閲覧不可
// - 404: 無効化済み/存在しないトークン

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

export type SharedViewErrorKind = 'login' | 'forbidden' | 'notfound' | 'error';

export class SharedViewError extends Error {
  kind: SharedViewErrorKind;
  constructor(kind: SharedViewErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** 共有閲覧APIを叩く。失敗は SharedViewError で種別つきに変換する。 */
export async function fetchSharedView<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {};
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { headers });
  } catch {
    throw new SharedViewError('error', '読み込みに失敗しました');
  }
  if (res.ok) return res.json() as Promise<T>;

  if (res.status === 401) {
    throw new SharedViewError(
      'login',
      'この共有リンクは組織メンバー限定です。ログインしてから開き直してください。',
    );
  }
  if (res.status === 403) {
    throw new SharedViewError(
      'forbidden',
      'この共有リンクは、共有元と同じ組織のメンバーのみ閲覧できます。',
    );
  }
  if (res.status === 404) {
    throw new SharedViewError(
      'notfound',
      'この共有リンクは無効です（発行者が無効化したか、URLが誤っています）。',
    );
  }
  throw new SharedViewError('error', '読み込みに失敗しました');
}
