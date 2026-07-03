import { Injectable, Logger } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { GoogleVerifierService, GoogleProfile } from '../../domain';

/**
 * google-auth-library による ID トークン検証。
 * GOOGLE_CLIENT_ID 未設定なら常に null（= Google ログイン無効）。
 */
@Injectable()
export class GoogleAuthLibraryVerifierService implements GoogleVerifierService {
  private readonly logger = new Logger(GoogleAuthLibraryVerifierService.name);

  async verifyIdToken(idToken: string): Promise<GoogleProfile | null> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return null;

    try {
      const client = new OAuth2Client(clientId);
      const ticket = await client.verifyIdToken({ idToken, audience: clientId });
      const payload = ticket.getPayload();
      if (!payload || !payload.sub || !payload.email) return null;

      return {
        googleId: payload.sub,
        email: payload.email,
        emailVerified: Boolean(payload.email_verified),
        name: payload.name ?? null,
        picture: payload.picture ?? null,
      };
    } catch (err) {
      this.logger.warn(`Google ID token verification failed: ${String(err)}`);
      return null;
    }
  }
}
