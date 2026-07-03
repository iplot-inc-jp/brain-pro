/**
 * Google ID トークンから取り出すプロフィール。
 */
export interface GoogleProfile {
  googleId: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

/**
 * Google ID トークン検証サービス。
 * インフラ層で google-auth-library を使って実装する。
 */
export interface GoogleVerifierService {
  /**
   * ID トークンを検証して GoogleProfile を返す。無効 or 未設定なら null。
   */
  verifyIdToken(idToken: string): Promise<GoogleProfile | null>;
}

export const GOOGLE_VERIFIER_SERVICE = Symbol('GOOGLE_VERIFIER_SERVICE');
