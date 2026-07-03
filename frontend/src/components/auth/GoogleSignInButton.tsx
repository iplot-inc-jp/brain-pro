'use client';

import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

/** Google ログインが有効か（クライアントID が設定されているか）。 */
export const isGoogleEnabled = Boolean(CLIENT_ID);

export type GoogleAuthedData = {
  accessToken: string;
  user: { id: string; email: string; name: string | null };
  joinedOrganizationId?: string | null;
};

/**
 * Google サインインボタン。NEXT_PUBLIC_GOOGLE_CLIENT_ID 未設定なら null を返す。
 * 成功時に accessToken を localStorage に保存し onAuthed を呼ぶ。
 */
export function GoogleSignInButton({
  inviteToken,
  onAuthed,
  onError,
}: {
  inviteToken?: string;
  onAuthed: (data: GoogleAuthedData) => void;
  onError?: (msg: string) => void;
}) {
  if (!CLIENT_ID) return null;

  return (
    <GoogleOAuthProvider clientId={CLIENT_ID} locale="ja">
      <GoogleLogin
        text="signin_with"
        width="320"
        onSuccess={async (cred) => {
          if (!cred.credential) {
            onError?.('Google 認証に失敗しました');
            return;
          }
          try {
            const res = await fetch(`${API_URL}/api/auth/google`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ idToken: cred.credential, inviteToken }),
            });
            if (!res.ok) {
              const body = await res.json().catch(() => null);
              throw new Error(body?.message || 'Googleログインに失敗しました');
            }
            const data = (await res.json()) as GoogleAuthedData;
            localStorage.setItem('accessToken', data.accessToken);
            onAuthed(data);
          } catch (e) {
            onError?.(e instanceof Error ? e.message : 'エラーが発生しました');
          }
        }}
        onError={() => onError?.('Googleログインに失敗しました')}
      />
    </GoogleOAuthProvider>
  );
}
