import { Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../persistence/prisma/prisma.service';
import { CryptoService } from '../services/crypto.service';
import { assertSafeOutboundUrl } from '../services/url-safety';

/**
 * Google Drive ソースアダプタ（バッチ取り込みの DRIVE ソース）。
 *
 * OAuth 2.0（refresh token）でプロジェクト単位に Drive を接続し、ファイル一覧／ダウンロードを行う。
 * Google SDK は使わず raw fetch（既存方針）。トークン交換・API はすべて公式 REST エンドポイントを叩く。
 *
 * 非破壊フラグ（QStashService 同様）:
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI のいずれかが無ければ
 *   `driveEnabled=false`。この場合は authUrl/exchangeCode/accessTokenFor などが例外を投げ、
 *   コントローラ側で 503 相当として扱う（ローカルで Drive 未設定でも他機能は壊さない）。
 *
 * 秘匿情報:
 *   refresh_token は CryptoService(AES-256-GCM, TOKEN_ENC_KEY) で暗号化し DriveConnection.refreshTokenEnc に保存。
 *   復号は accessTokenFor の瞬間だけ。レスポンスでは決して返さない。
 *
 * SSRF 対策:
 *   files.get?alt=media のダウンロード URL（および token/api エンドポイント）は assertSafeOutboundUrl を通す。
 */

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3';
// Docs のドキュメントタブ / Sheets のシートタブ一覧の取得に使う（drive.readonly スコープで呼べる）。
const GOOGLE_DOCS_API = 'https://docs.googleapis.com/v1';
const GOOGLE_SHEETS_API = 'https://sheets.googleapis.com/v4';
// drive.readonly（読み取り専用）。最小権限。
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
// ユーザー識別子（email）取得用の最小スコープも合わせて要求。
const OAUTH_SCOPES = [DRIVE_SCOPE, 'openid', 'email'].join(' ');

// OAuth state（CSRF nonce 付き署名トークン）の有効期限（秒）。
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

/** OAuth state の検証結果（projectId は署名検証済みの信頼源）。 */
export interface VerifiedOAuthState {
  projectId: string;
  userId: string | null;
}

/** Drive ファイル一覧の1件（フロント契約と一致）。 */
export interface DriveFileRef {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string | null;
  isFolder: boolean;
}

/** ダウンロード結果。 */
export interface DriveDownload {
  bytes: Buffer;
  mimeType: string;
  filename: string;
}

/**
 * Google ドキュメントのタブ / スプレッドシートのシートの1件（フロント契約と一致）。
 * id は Docs なら tabId（例 "t.0"）、Sheets なら gid（数値の文字列）。
 * level は Docs のタブ入れ子の深さ（0=トップ。Sheets は常に 0）。
 */
export interface GoogleTabRef {
  id: string;
  title: string;
  index: number;
  level: number;
}

/** Docs API documents.get のタブ部分（tabProperties のみに field mask 済み）。 */
interface DocsApiTab {
  tabProperties?: { tabId?: string; title?: string; index?: number };
  childTabs?: DocsApiTab[];
}

/** base64url（パディング無し）エンコード。 */
function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url デコード。 */
function base64UrlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** CSRF 用の単回ナンス（128bit）。 */
function randomNonce(): string {
  return base64UrlEncode(randomBytes(16));
}

/**
 * SSRF 安全な外部 fetch。
 *
 * url-safety.ts の方針どおり assertSafeOutboundUrl 済みの URL に対し redirect:'manual' で発火し、
 * 3xx の場合は Location を assertSafeOutboundUrl で再検証してから（最大数ホップ）追う。
 * 不正な Location は UnsafeUrlError として拒否（内部ホストへのリダイレクト誘導を防ぐ）。
 */
async function safeFetch(
  initialUrl: string,
  init: RequestInit,
  maxRedirects = 5,
): Promise<Response> {
  let current = (await assertSafeOutboundUrl(initialUrl)).toString();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) {
      return res;
    }
    const location = res.headers.get('location');
    if (!location) {
      // 3xx だが Location 無し。そのまま返す（呼び出し側で !ok として扱われる）。
      return res;
    }
    // 相対 Location も解決し、追従前に必ず再検証（DNS リバインディング/内部誘導の緩和）。
    const next = new URL(location, current).toString();
    current = (await assertSafeOutboundUrl(next)).toString();
  }
  throw new Error('リダイレクトが多すぎます（外部取得を中止しました）');
}

@Injectable()
export class DriveService {
  private readonly logger = new Logger(DriveService.name);

  /** OAuth が構成済みか（client id/secret/redirect uri がすべて揃っているか）。 */
  readonly driveEnabled: boolean;

  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly redirectUri?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {
    this.clientId = process.env.GOOGLE_CLIENT_ID?.trim() || undefined;
    this.clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || undefined;
    this.redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || undefined;
    this.driveEnabled = !!(this.clientId && this.clientSecret && this.redirectUri);
    if (!this.driveEnabled) {
      this.logger.log(
        'Drive 連携は未構成です（GOOGLE_CLIENT_ID/SECRET/OAUTH_REDIRECT_URI のいずれか欠落）。DRIVE ソースは無効。',
      );
    }
  }

  /** driveEnabled でなければ例外（コントローラで 503 相当へ）。 */
  private ensureEnabled(): void {
    if (!this.driveEnabled) {
      throw new Error(
        'Google Drive 連携が未構成です（GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI を設定してください）',
      );
    }
  }

  /**
   * 同意画面の URL を組み立てる。
   * state は {projectId, userId, nonce, exp} を HMAC(TOKEN_ENC_KEY) で署名した
   * 単回・期限付きトークン（推測・改ざん・横流し不可）。コールバックで verifyState して projectId を信頼源にする。
   * access_type=offline + prompt=consent で refresh_token を確実に得る。
   */
  authUrl(projectId: string, userId?: string): string {
    this.ensureEnabled();
    const params = new URLSearchParams({
      client_id: this.clientId as string,
      redirect_uri: this.redirectUri as string,
      response_type: 'code',
      scope: OAUTH_SCOPES,
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state: this.signState(projectId, userId ?? null),
    });
    return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
  }

  /**
   * state を発行する。payload({projectId,userId,nonce,exp}) を base64url(JSON) にし、
   * HMAC-SHA256(TOKEN_ENC_KEY) 署名を付けて `payload.sig` 形式で返す。
   */
  private signState(projectId: string, userId: string | null): string {
    const payload = {
      projectId,
      userId,
      nonce: randomNonce(),
      exp: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS,
    };
    const body = base64UrlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
    const sig = this.stateSignature(body);
    return `${body}.${sig}`;
  }

  /**
   * state を検証する。署名不一致・改ざん・期限切れ・形式不正は例外。
   * 返す projectId は署名検証済みなので callback の信頼源として使える。
   */
  verifyState(rawState: string): VerifiedOAuthState {
    if (!rawState || typeof rawState !== 'string') {
      throw new Error('state がありません');
    }
    const dot = rawState.lastIndexOf('.');
    if (dot <= 0) {
      throw new Error('state の形式が不正です');
    }
    const body = rawState.slice(0, dot);
    const sig = rawState.slice(dot + 1);
    const expected = this.stateSignature(body);
    // 定数時間比較（長さ不一致は false 扱い）。
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('state の署名が不正です');
    }
    let payload: { projectId?: unknown; userId?: unknown; exp?: unknown };
    try {
      payload = JSON.parse(base64UrlDecode(body).toString('utf8')) as typeof payload;
    } catch {
      throw new Error('state のペイロードが不正です');
    }
    if (typeof payload.projectId !== 'string' || !payload.projectId) {
      throw new Error('state に projectId がありません');
    }
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error('state の有効期限が切れています');
    }
    return {
      projectId: payload.projectId,
      userId: typeof payload.userId === 'string' ? payload.userId : null,
    };
  }

  /** state body の HMAC-SHA256 署名（TOKEN_ENC_KEY を鍵に使用、base64url）。 */
  private stateSignature(body: string): string {
    return base64UrlEncode(
      createHmac('sha256', this.stateSigningKey()).update(body).digest(),
    );
  }

  /**
   * state 署名鍵。TOKEN_ENC_KEY を SHA-256 で派生（暗号化鍵とは用途分離のためドメイン文字列を混ぜる）。
   * 未設定でも CryptoService と同様に安定 dev 鍵へフォールバックする。
   */
  private stateSigningKey(): Buffer {
    const hex = process.env.TOKEN_ENC_KEY?.trim();
    const seed =
      hex && /^[0-9a-fA-F]{64}$/.test(hex)
        ? hex
        : 'ai-data-flow:token-enc:dev-fallback-key:v1';
    return createHash('sha256').update(`drive-oauth-state:${seed}`).digest();
  }

  /**
   * 認可コードを token に交換し、refresh_token を暗号化して DriveConnection に upsert（projectId 単位）。
   * email は id_token（JWT payload）から best-effort で取り出す。
   */
  async exchangeCode(
    code: string,
    projectId: string,
    createdById?: string,
  ): Promise<{ id: string; email: string | null }> {
    this.ensureEnabled();

    const body = new URLSearchParams({
      code,
      client_id: this.clientId as string,
      client_secret: this.clientSecret as string,
      redirect_uri: this.redirectUri as string,
      grant_type: 'authorization_code',
    });

    const res = await safeFetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Google トークン交換に失敗しました（${res.status}）: ${text.slice(0, 300)}`);
    }
    const tokens = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      scope?: string;
      id_token?: string;
    };
    if (!tokens.refresh_token) {
      // 既に同意済み（refresh_token を再発行しない）のケース。prompt=consent で回避するが念のため。
      throw new Error(
        'refresh_token が取得できませんでした。Google アカウントの権限を一度解除してから再接続してください。',
      );
    }

    const email = this.emailFromIdToken(tokens.id_token);
    const refreshTokenEnc = this.crypto.encrypt(tokens.refresh_token);

    // projectId 単位に1接続（@@unique([projectId])）。同時 callback でも重複行にならないよう upsert。
    const conn = await this.prisma.driveConnection.upsert({
      where: { projectId },
      update: { refreshTokenEnc, email, scope: tokens.scope ?? OAUTH_SCOPES },
      create: {
        projectId,
        refreshTokenEnc,
        email,
        scope: tokens.scope ?? OAUTH_SCOPES,
        createdById: createdById ?? null,
      },
      select: { id: true, email: true },
    });
    return { id: conn.id, email: conn.email };
  }

  /**
   * プロジェクトの保存済み refresh_token から access_token を取得する。
   * 接続が無ければ例外。
   */
  async accessTokenFor(projectId: string): Promise<string> {
    this.ensureEnabled();
    const conn = await this.prisma.driveConnection.findFirst({
      where: { projectId },
      select: { refreshTokenEnc: true },
    });
    if (!conn) {
      throw new Error('このプロジェクトには Google Drive 接続がありません');
    }
    const refreshToken = this.crypto.decrypt(conn.refreshTokenEnc);

    const body = new URLSearchParams({
      client_id: this.clientId as string,
      client_secret: this.clientSecret as string,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const res = await safeFetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Google access_token の更新に失敗しました（${res.status}）: ${text.slice(0, 300)}`,
      );
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) {
      throw new Error('Google access_token が取得できませんでした');
    }
    return json.access_token;
  }

  /**
   * ファイル/フォルダ一覧。folderId 指定でそのフォルダ直下、未指定はルート相当（My Drive）。
   * 任意の q（Drive クエリ）も受ける。ゴミ箱は除外。
   */
  async listFiles(
    projectId: string,
    opts?: { folderId?: string; q?: string; pageSize?: number },
  ): Promise<DriveFileRef[]> {
    this.ensureEnabled();
    const accessToken = await this.accessTokenFor(projectId);

    const clauses: string[] = ['trashed = false'];
    if (opts?.folderId) {
      clauses.push(`'${this.escapeQ(opts.folderId)}' in parents`);
    }
    if (opts?.q && opts.q.trim()) {
      // フリーテキストは name contains に正規化（任意の Drive クエリ注入を避ける）。
      clauses.push(`name contains '${this.escapeQ(opts.q.trim())}'`);
    }

    const params = new URLSearchParams({
      q: clauses.join(' and '),
      fields: 'files(id,name,mimeType,size,modifiedTime),nextPageToken',
      pageSize: String(Math.min(Math.max(opts?.pageSize ?? 200, 1), 1000)),
      orderBy: 'folder,name',
      spaces: 'drive',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });

    const url = `${GOOGLE_DRIVE_API}/files?${params.toString()}`;
    const res = await safeFetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Drive files.list に失敗しました（${res.status}）: ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      files?: {
        id: string;
        name: string;
        mimeType: string;
        size?: string;
        modifiedTime?: string;
      }[];
    };
    return (json.files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size ? Number(f.size) : null,
      modifiedTime: f.modifiedTime ?? null,
      isFolder: f.mimeType === 'application/vnd.google-apps.folder',
    }));
  }

  /**
   * 1ファイルをダウンロード（files.get?alt=media）。
   * Google ネイティブ形式（Docs/Sheets/Slides）は files/export で Office 形式へ変換取得する。
   */
  async downloadFile(projectId: string, fileId: string): Promise<DriveDownload> {
    this.ensureEnabled();
    const accessToken = await this.accessTokenFor(projectId);

    // メタ情報（name / mimeType）を先に取得。
    const metaParams = new URLSearchParams({
      fields: 'id,name,mimeType,size',
      supportsAllDrives: 'true',
    });
    const metaUrl = `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(fileId)}?${metaParams.toString()}`;
    const metaRes = await safeFetch(metaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!metaRes.ok) {
      const text = await metaRes.text().catch(() => '');
      throw new Error(`Drive files.get(meta) に失敗しました（${metaRes.status}）: ${text.slice(0, 300)}`);
    }
    const meta = (await metaRes.json()) as { name: string; mimeType: string };

    const exportMime = this.exportMimeFor(meta.mimeType);
    let downloadUrl: string;
    let filename = meta.name;
    let resultMime: string;

    if (exportMime) {
      // Google ネイティブ → Office 形式へエクスポート。
      const params = new URLSearchParams({ mimeType: exportMime });
      downloadUrl = `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(fileId)}/export?${params.toString()}`;
      resultMime = exportMime;
      filename = this.withExportExtension(meta.name, exportMime);
    } else {
      const params = new URLSearchParams({
        alt: 'media',
        supportsAllDrives: 'true',
      });
      downloadUrl = `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(fileId)}?${params.toString()}`;
      resultMime = meta.mimeType;
    }

    const res = await safeFetch(downloadUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Drive files.get(media) に失敗しました（${res.status}）: ${text.slice(0, 300)}`,
      );
    }
    const ab = await res.arrayBuffer();
    return { bytes: Buffer.from(ab), mimeType: resultMime, filename };
  }

  /**
   * Google ドキュメントのタブ一覧（documents.get）。
   * includeTabsContent=true が必須（false だと tabs が空になる仕様）だが、
   * field mask で tabProperties のみに絞るため本文は転送されない。
   * タブの入れ子は仕様上 3 階層まで。mask は余裕を見て 4 階層分持つ。
   */
  async listDocumentTabs(projectId: string, documentId: string): Promise<GoogleTabRef[]> {
    this.ensureEnabled();
    const accessToken = await this.accessTokenFor(projectId);

    const props = 'tabProperties(tabId,title,index)';
    const fields = `tabs(${props},childTabs(${props},childTabs(${props},childTabs(${props}))))`;
    const params = new URLSearchParams({
      includeTabsContent: 'true',
      fields,
    });
    const url = `${GOOGLE_DOCS_API}/documents/${encodeURIComponent(documentId)}?${params.toString()}`;
    const res = await safeFetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Docs documents.get に失敗しました（${res.status}）: ${text.slice(0, 300)}`,
      );
    }
    const json = (await res.json()) as { tabs?: DocsApiTab[] };
    const flat: GoogleTabRef[] = [];
    const walk = (tabs: DocsApiTab[], level: number) => {
      for (const t of tabs) {
        const p = t.tabProperties;
        if (p?.tabId) {
          flat.push({
            id: p.tabId,
            title: p.title ?? '',
            index: p.index ?? flat.length,
            level,
          });
        }
        if (t.childTabs?.length) walk(t.childTabs, level + 1);
      }
    };
    walk(json.tabs ?? [], 0);
    return flat;
  }

  /**
   * スプレッドシートのシート（タブ）一覧（spreadsheets.get、properties のみ）。
   * 非表示シートはプレビューで開けないため除外する。id は gid（数値の文字列）。
   */
  async listSpreadsheetSheets(
    projectId: string,
    spreadsheetId: string,
  ): Promise<GoogleTabRef[]> {
    this.ensureEnabled();
    const accessToken = await this.accessTokenFor(projectId);

    const params = new URLSearchParams({
      fields: 'sheets.properties(sheetId,title,index,hidden)',
    });
    const url = `${GOOGLE_SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}?${params.toString()}`;
    const res = await safeFetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Sheets spreadsheets.get に失敗しました（${res.status}）: ${text.slice(0, 300)}`,
      );
    }
    const json = (await res.json()) as {
      sheets?: {
        properties?: { sheetId?: number; title?: string; index?: number; hidden?: boolean };
      }[];
    };
    return (json.sheets ?? [])
      .map((s) => s.properties)
      .filter((p): p is NonNullable<typeof p> => !!p && p.sheetId !== undefined && !p.hidden)
      .map((p, i) => ({
        id: String(p.sheetId),
        title: p.title ?? '',
        index: p.index ?? i,
        level: 0,
      }));
  }

  /** プロジェクトの Drive 接続を削除（フロント「切断」）。 */
  async deleteConnection(projectId: string): Promise<{ deleted: number }> {
    const result = await this.prisma.driveConnection.deleteMany({
      where: { projectId },
    });
    return { deleted: result.count };
  }

  /** 接続状態（email のみ。トークンは返さない）。 */
  async getConnection(
    projectId: string,
  ): Promise<{ connected: boolean; email: string | null }> {
    const conn = await this.prisma.driveConnection.findFirst({
      where: { projectId },
      select: { email: true },
    });
    return { connected: !!conn, email: conn?.email ?? null };
  }

  // ===================== 内部ヘルパ =====================

  /** Drive クエリ用のエスケープ（シングルクオート・バックスラッシュ）。 */
  private escapeQ(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  /** id_token(JWT) の payload から email を best-effort で取り出す（署名検証はしない）。 */
  private emailFromIdToken(idToken?: string): string | null {
    if (!idToken) return null;
    try {
      const payload = idToken.split('.')[1];
      if (!payload) return null;
      const json = Buffer.from(
        payload.replace(/-/g, '+').replace(/_/g, '/'),
        'base64',
      ).toString('utf8');
      const parsed = JSON.parse(json) as { email?: string };
      return parsed.email ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Google ネイティブ形式のときの export 先 MIME（Office 形式）。
   * ネイティブでなければ null（通常の alt=media ダウンロード）。
   */
  private exportMimeFor(mimeType: string): string | null {
    switch (mimeType) {
      case 'application/vnd.google-apps.document':
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      case 'application/vnd.google-apps.spreadsheet':
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      case 'application/vnd.google-apps.presentation':
        return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      case 'application/vnd.google-apps.drawing':
        return 'application/pdf';
      default:
        return null;
    }
  }

  /** export 後のファイル名に拡張子を付与（パイプラインの classify が拡張子で型判定するため）。 */
  private withExportExtension(name: string, exportMime: string): string {
    const extByMime: Record<string, string> = {
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
      'application/pdf': '.pdf',
    };
    const ext = extByMime[exportMime];
    if (!ext) return name;
    return new RegExp(`${ext.replace('.', '\\.')}$`, 'i').test(name)
      ? name
      : `${name}${ext}`;
  }
}
