# brain-pro ユーザー追従APIトークン（JWT）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** brain-pro に「発行ユーザーの現在の権限に追従する HS256 JWT の APIトークン」を新設し、ipro-kun がそれを Bearer で送れるようにする（sk_ キーは共存）。

**Architecture:** JWT は本人性（`sub`=userId）＋失効識別子（`jti`=DB行id）だけを主張し、org/プロジェクト権限は claim に焼き込まない。`JwtAuthGuard` が JWT を検証して `request.user = { id: userId }`（apiKeyRole 無し）を載せると、既存の `ProjectAccessService.resolveForPrincipal` がユーザーの会員RBACで毎回認可する（＝権限追従・追加認可ロジック不要）。失効は `user_api_tokens.revokedAt`。

**Tech Stack:** NestJS + Prisma（backend）／ Next.js（frontend）／ node:crypto（HMAC-SHA256・自前JWT、ipro-kun の service-account-auth と同形）／ jest（backend単体）／ vitest（ipro-kun）。

## Global Constraints

- JWT 形式（自前 crypto・HS256）: header `{"alg":"HS256","typ":"JWT"}`、payload `{ sub:<userId>, jti:<user_api_tokens.id>, kind:"user-api", iat:<秒>, exp:<秒> }`。**iat/exp は秒**（ipro の ms/秒混在は踏襲しない）。
- 署名鍵 env: **`BRAINPRO_API_JWT_SECRET`**（ログイン用 `JWT_SECRET` とは別鍵）。未設定なら発行・検証はエラー（fail-closed）。
- user-api トークンの `request.user` は **`{ id: userId }` のみ**（`apiKeyRole` を絶対に付けない＝ユーザーRBAC経路へ）。
- 署名照合は **`crypto.timingSafeEqual`**。検証失敗（署名・期限・kind不一致・jti行なし・revoked・sub不一致）は**すべて 401（fail-closed）**。
- **sk_ キーは無改変で共存**（`JwtAuthGuard` の sk_ 経路・`api-key.controller`・既存UIは触らない）。
- ipro-kun は保存トークン文字列を**そのまま `Authorization: Bearer <token>` で送る**（sk_ でも JWT でも動く。brain-pro の `ApiKeyService.extract` は `Bearer sk_…` を受理、JWT は新経路が受理）。ipro-kun 側スキーマ変更なし。
- 読み書き可（ipro の権限追従トークンは read-only だが、本トークンはユーザーの EDIT 権限に従って read-write）。
- 平文JWTは保存しない（発行レスポンスでのみ返す）。DBは `user_api_tokens` のメタデータ（jti行）だけ。

---

## File Structure

**brain-pro backend**
- Create `backend/src/infrastructure/services/user-api-jwt.ts` — 純粋関数の署名/検証（node:crypto）。DB非依存。
- Create `backend/src/infrastructure/services/user-api-jwt.spec.ts`
- Create `backend/src/infrastructure/services/user-api-token.service.ts` — mint/resolve/list/revoke（Prisma依存）。
- Create `backend/src/infrastructure/services/user-api-token.service.spec.ts`
- Create `backend/src/presentation/controllers/user-api-token.controller.ts` — `/api/user/api-tokens`。
- Create `backend/src/presentation/controllers/user-api-token.controller.spec.ts`
- Create `backend/src/presentation/guards/jwt-auth.user-api.spec.ts` — ガードの user-api 経路の単体。
- Create `backend/src/application/use-cases/project/create-project.user-principal.spec.ts` — 権限追従の回帰（非会員 403）。
- Modify `backend/prisma/schema.prisma` — `model UserApiToken` ＋ `User.userApiTokens` 逆リレーション。
- Modify（新規migration） `backend/prisma/migrations/<timestamp>_add_user_api_token/migration.sql`
- Modify `backend/src/presentation/guards/jwt-auth.guard.ts` — user-api 経路を追加。
- Modify `backend/src/app.module.ts` — `UserApiTokenService`（provider）＋`UserApiTokenController`（controller）を登録。
- Modify `backend/.env.example` — `BRAINPRO_API_JWT_SECRET` を追記。
- Modify `backend/.env` / `backend/.env.local`（gitignore対象・ローカル値を書き出す）。

**brain-pro frontend**
- Modify `frontend/src/app/(dashboard)/dashboard/settings/page.tsx` — 「APIトークン」セクション（発行/一覧/失効）。

**ipro-kun**
- Modify `ipro-agent/core/brainpro.ts` — `x-api-key` 5か所 → `Authorization: Bearer`。
- Modify `ipro-agent/core/brainpro.test.ts` — ヘッダ検証を Bearer に更新。
- Modify `ipro-ui/agent/BrainproLinksView.tsx` / `ipro-ui/agent/BrainproOrgForm.tsx` — 文言（JWTトークンも可）。

---

### Task 1: Prisma モデル `UserApiToken` ＋ migration

**Files:**
- Modify: `backend/prisma/schema.prisma`（`model ApiKey` の直後・User モデル 17行目付近に逆リレーション）
- Create: `backend/prisma/migrations/<timestamp>_add_user_api_token/migration.sql`（`prisma migrate dev` が生成）

**Interfaces:**
- Produces: Prisma Client 型 `UserApiToken { id, userId, name, lastUsedAt, revokedAt, createdAt }`。`id` が JWT の `jti`。

- [ ] **Step 1: schema.prisma にモデル追加**

`model ApiKey { ... }` の直後に追記:

```prisma
model UserApiToken {
  id         String    @id @default(uuid())
  userId     String    @map("user_id")
  name       String
  lastUsedAt DateTime? @map("last_used_at")
  revokedAt  DateTime? @map("revoked_at")
  createdAt  DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("user_api_tokens")
}
```

- [ ] **Step 2: User モデルに逆リレーション追加**

`model User { ... }`（17行目付近）の relation 列挙に1行足す（他の `@relation` 逆参照と同じ場所）:

```prisma
  userApiTokens UserApiToken[]
```

- [ ] **Step 3: migration 生成＋ローカル適用＋Client再生成**

Run: `cd ~/brain-pro/backend && npx prisma migrate dev --name add_user_api_token`
Expected: `migrations/<ts>_add_user_api_token/migration.sql` が作られ、`user_api_tokens` が CREATE され、`✔ Generated Prisma Client` が出る。

- [ ] **Step 4: 型が通ることを確認**

Run: `cd ~/brain-pro/backend && npx tsc --noEmit`
Expected: エラーなし（`prisma.userApiToken` が型として使える）。

- [ ] **Step 5: Commit**

```bash
cd ~/brain-pro && git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(brainpro): user_api_tokens テーブル（ユーザー追従APIトークンの失効台帳）"
```

---

### Task 2: JWT 署名/検証モジュール ＋ `BRAINPRO_API_JWT_SECRET`

**Files:**
- Create: `backend/src/infrastructure/services/user-api-jwt.ts`
- Test: `backend/src/infrastructure/services/user-api-jwt.spec.ts`
- Modify: `backend/.env.example`, `backend/.env`, `backend/.env.local`

**Interfaces:**
- Produces:
  - `signUserApiJwt(input: { userId: string; jti: string }, nowSec: number, ttlSec?: number): string`
  - `verifyUserApiJwt(token: string, nowSec: number): UserApiClaims | null`
  - `peekKind(token: string): string | null`
  - `interface UserApiClaims { sub: string; jti: string; kind: 'user-api'; iat: number; exp: number }`

- [ ] **Step 1: 失敗するテストを書く**

`backend/src/infrastructure/services/user-api-jwt.spec.ts`:

```ts
import { signUserApiJwt, verifyUserApiJwt, peekKind } from './user-api-jwt';

describe('user-api-jwt', () => {
  const NOW = 1_700_000_000; // 秒
  beforeAll(() => { process.env.BRAINPRO_API_JWT_SECRET = 'test-secret'; });

  it('sign→verify で claims が復元できる', () => {
    const t = signUserApiJwt({ userId: 'u1', jti: 'j1' }, NOW);
    const c = verifyUserApiJwt(t, NOW);
    expect(c).toMatchObject({ sub: 'u1', jti: 'j1', kind: 'user-api' });
    expect(c!.exp).toBeGreaterThan(NOW);
  });

  it('peekKind は署名前に kind を覗ける', () => {
    const t = signUserApiJwt({ userId: 'u1', jti: 'j1' }, NOW);
    expect(peekKind(t)).toBe('user-api');
    expect(peekKind('not.a.jwt')).toBe(null);
  });

  it('署名改竄は null', () => {
    const t = signUserApiJwt({ userId: 'u1', jti: 'j1' }, NOW);
    const tampered = t.slice(0, -2) + (t.endsWith('aa') ? 'bb' : 'aa');
    expect(verifyUserApiJwt(tampered, NOW)).toBe(null);
  });

  it('別の鍵で署名されたトークンは null', () => {
    const t = signUserApiJwt({ userId: 'u1', jti: 'j1' }, NOW);
    process.env.BRAINPRO_API_JWT_SECRET = 'other-secret';
    expect(verifyUserApiJwt(t, NOW)).toBe(null);
    process.env.BRAINPRO_API_JWT_SECRET = 'test-secret';
  });

  it('期限切れは null', () => {
    const t = signUserApiJwt({ userId: 'u1', jti: 'j1' }, NOW, 10);
    expect(verifyUserApiJwt(t, NOW + 11)).toBe(null);
  });

  it('kind が user-api でなければ null（他JWTの誤受理防止）', () => {
    // header.payload.sig を手組みして kind を変える
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'u1', jti: 'j1', kind: 'login', iat: NOW, exp: NOW + 100 })).toString('base64url');
    const { createHmac } = require('node:crypto');
    const sig = createHmac('sha256', 'test-secret').update(`${header}.${payload}`).digest('base64url');
    expect(verifyUserApiJwt(`${header}.${payload}.${sig}`, NOW)).toBe(null);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `cd ~/brain-pro/backend && npx jest src/infrastructure/services/user-api-jwt.spec.ts`
Expected: FAIL（`Cannot find module './user-api-jwt'`）。

- [ ] **Step 3: モジュールを実装**

`backend/src/infrastructure/services/user-api-jwt.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

// ユーザー追従APIトークン = HS256 JWT（依存なし・node crypto のみ。ipro-kun の service-account-auth と同形）。
// claims は本人性(sub)＋失効識別子(jti)＋種別(kind)＋時刻(iat/exp・秒)。org/プロジェクト権限は載せない
// （＝毎リクエスト userId の会員RBACで解決＝権限追従）。失効は DB(user_api_tokens.revokedAt) で効かせる。

const DEFAULT_TTL_SEC = 365 * 24 * 60 * 60; // 長寿命。取り消しは DB 側。

export interface UserApiClaims {
  sub: string; // brain-pro userId
  jti: string; // user_api_tokens.id
  kind: 'user-api';
  iat: number; // 秒
  exp: number; // 秒
}

function secret(): string {
  const s = process.env.BRAINPRO_API_JWT_SECRET;
  if (!s) throw new Error('BRAINPRO_API_JWT_SECRET is required');
  return s;
}

function b64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** ガードの経路分岐用に kind だけ署名前に覗く（信用しない＝この後必ず署名検証する）。 */
export function peekKind(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload?.kind === 'string' ? payload.kind : null;
  } catch {
    return null;
  }
}

/** userId + jti から user-api JWT を署名。平文は呼び出し側で1回だけ返す。 */
export function signUserApiJwt(
  input: { userId: string; jti: string },
  nowSec: number,
  ttlSec: number = DEFAULT_TTL_SEC,
): string {
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const claims: UserApiClaims = {
    sub: input.userId,
    jti: input.jti,
    kind: 'user-api',
    iat: nowSec,
    exp: nowSec + ttlSec,
  };
  const payload = b64urlJson(claims);
  const signingInput = `${header}.${payload}`;
  const sig = createHmac('sha256', secret()).update(signingInput).digest('base64url');
  return `${signingInput}.${sig}`;
}

/** 署名・期限・kind を検証して claims を返す。失敗は null（fail-closed）。jti行の生存確認は呼び出し側。 */
export function verifyUserApiJwt(token: string, nowSec: number): UserApiClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expected = createHmac('sha256', secret()).update(`${h}.${p}`).digest('base64url');
  const a = Buffer.from(sig);
  const e = Buffer.from(expected);
  if (a.length !== e.length || !timingSafeEqual(a, e)) return null;

  let claims: UserApiClaims;
  try {
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    if (header?.alg !== 'HS256') return null;
    claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (claims.kind !== 'user-api') return null;
  if (typeof claims.sub !== 'string' || typeof claims.jti !== 'string') return null;
  if (typeof claims.exp !== 'number' || nowSec > claims.exp) return null;
  return claims;
}
```

- [ ] **Step 4: テスト通過を確認**

Run: `cd ~/brain-pro/backend && npx jest src/infrastructure/services/user-api-jwt.spec.ts`
Expected: PASS（6 tests）。

- [ ] **Step 5: env を書き出す（ローカル＋example）**

`backend/.env.example` の `JWT_EXPIRES_IN=7d`（9行目付近）の直後に追記:

```
# ---- ユーザー追従APIトークン（外部連携。ログイン用 JWT_SECRET とは別鍵）----
BRAINPRO_API_JWT_SECRET=change-me-to-a-long-random-string
```

ローカル `.env` と `.env.local` の両方に、生成した実値を書き出す:

Run:
```bash
cd ~/brain-pro/backend
SECRET=$(openssl rand -base64 48 | tr -d '\n')
printf '\nBRAINPRO_API_JWT_SECRET=%s\n' "$SECRET" >> .env
printf '\nBRAINPRO_API_JWT_SECRET=%s\n' "$SECRET" >> .env.local
grep -c BRAINPRO_API_JWT_SECRET .env .env.local
```
Expected: `.env:1` と `.env.local:1`（各ファイルに1行入った）。**本番の値はユーザーが Vercel/デプロイ先に別途設定**（この plan では触らない）。

- [ ] **Step 6: Commit**

```bash
cd ~/brain-pro && git add backend/src/infrastructure/services/user-api-jwt.ts backend/src/infrastructure/services/user-api-jwt.spec.ts backend/.env.example
git commit -m "feat(brainpro): user-api JWT の署名/検証（自前HS256・秒claims・BRAINPRO_API_JWT_SECRET）"
```
（`.env` / `.env.local` は gitignore 対象なので commit されない＝意図どおり）

---

### Task 3: `UserApiTokenService`（mint/resolve/list/revoke）＋ provider 登録

**Files:**
- Create: `backend/src/infrastructure/services/user-api-token.service.ts`
- Test: `backend/src/infrastructure/services/user-api-token.service.spec.ts`
- Modify: `backend/src/app.module.ts`（providers 配列・1107行目 `ApiKeyService,` の隣）

**Interfaces:**
- Consumes: `signUserApiJwt`, `verifyUserApiJwt`（Task 2）／ `PrismaService`。
- Produces:
  - `mint(userId: string, name: string, nowMs: number): Promise<{ id: string; name: string; token: string; createdAt: Date }>`
  - `resolve(token: string, nowMs: number): Promise<{ userId: string } | null>`
  - `list(userId: string): Promise<{ id; name; lastUsedAt; createdAt }[]>`
  - `revoke(userId: string, id: string): Promise<void>`

- [ ] **Step 1: 失敗するテストを書く**

`backend/src/infrastructure/services/user-api-token.service.spec.ts`:

```ts
import { UserApiTokenService } from './user-api-token.service';

describe('UserApiTokenService', () => {
  const NOW = 1_700_000_000_000; // ms
  beforeAll(() => { process.env.BRAINPRO_API_JWT_SECRET = 'test-secret'; });

  const makePrisma = (row: any) => ({
    userApiToken: {
      create: jest.fn().mockResolvedValue({ id: 'tok-1', name: 'ipro', createdAt: new Date(NOW) }),
      findUnique: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([{ id: 'tok-1', name: 'ipro', lastUsedAt: null, createdAt: new Date(NOW) }]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  }) as any;

  it('mint: 行を作り、その id を jti にした JWT を返す', async () => {
    const prisma = makePrisma(null);
    const svc = new UserApiTokenService(prisma);
    const out = await svc.mint('user-1', 'ipro', NOW);
    expect(prisma.userApiToken.create).toHaveBeenCalledWith({ data: { userId: 'user-1', name: 'ipro' } });
    expect(out.token.split('.')).toHaveLength(3);
    // 返ったトークンを resolve すると userId が取れる（同じ行が生きている前提）
    const prisma2 = makePrisma({ id: 'tok-1', userId: 'user-1', revokedAt: null });
    const svc2 = new UserApiTokenService(prisma2);
    expect(await svc2.resolve(out.token, NOW)).toEqual({ userId: 'user-1' });
  });

  it('resolve: jti行が revoked なら null', async () => {
    const prisma = makePrisma(null);
    const { token } = await new UserApiTokenService(prisma).mint('user-1', 'ipro', NOW);
    const prismaRevoked = makePrisma({ id: 'tok-1', userId: 'user-1', revokedAt: new Date(NOW) });
    expect(await new UserApiTokenService(prismaRevoked).resolve(token, NOW)).toBe(null);
  });

  it('resolve: jti行が無ければ null', async () => {
    const prisma = makePrisma(null);
    const { token } = await new UserApiTokenService(prisma).mint('user-1', 'ipro', NOW);
    const prismaGone = makePrisma(null);
    expect(await new UserApiTokenService(prismaGone).resolve(token, NOW)).toBe(null);
  });

  it('resolve: sub と行の userId が食い違えば null', async () => {
    const prisma = makePrisma(null);
    const { token } = await new UserApiTokenService(prisma).mint('user-1', 'ipro', NOW);
    const prismaMismatch = makePrisma({ id: 'tok-1', userId: 'someone-else', revokedAt: null });
    expect(await new UserApiTokenService(prismaMismatch).resolve(token, NOW)).toBe(null);
  });

  it('revoke: userId でスコープして updateMany（他人のは消せない）', async () => {
    const prisma = makePrisma(null);
    await new UserApiTokenService(prisma).revoke('user-1', 'tok-1');
    expect(prisma.userApiToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'tok-1', userId: 'user-1' },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `cd ~/brain-pro/backend && npx jest src/infrastructure/services/user-api-token.service.spec.ts`
Expected: FAIL（`Cannot find module './user-api-token.service'`）。

- [ ] **Step 3: サービスを実装**

`backend/src/infrastructure/services/user-api-token.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../persistence/prisma/prisma.service';
import { signUserApiJwt, verifyUserApiJwt } from './user-api-jwt';

/**
 * ユーザー追従APIトークンの発行・検証・失効。
 * 発行: user_api_tokens 行を作り、その id を jti に埋めて署名。平文JWTは返り値のみ（DBに保存しない）。
 * 検証: 署名+期限（user-api-jwt）→ jti行の生存 → sub一致。権限は載せない（ガードが userId だけ載せ、
 *       ProjectAccessService がユーザーの会員RBACで毎回解決＝権限追従）。
 */
@Injectable()
export class UserApiTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async mint(
    userId: string,
    name: string,
    nowMs: number,
  ): Promise<{ id: string; name: string; token: string; createdAt: Date }> {
    const record = await this.prisma.userApiToken.create({ data: { userId, name } });
    const token = signUserApiJwt({ userId, jti: record.id }, Math.floor(nowMs / 1000));
    return { id: record.id, name: record.name, token, createdAt: record.createdAt };
  }

  async resolve(token: string, nowMs: number): Promise<{ userId: string } | null> {
    const claims = verifyUserApiJwt(token, Math.floor(nowMs / 1000));
    if (!claims) return null;
    const row = await this.prisma.userApiToken.findUnique({ where: { id: claims.jti } });
    if (!row || row.revokedAt) return null;
    if (row.userId !== claims.sub) return null;
    // 監査。失敗しても認証は継続。
    void this.prisma.userApiToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date(nowMs) } })
      .catch(() => undefined);
    return { userId: row.userId };
  }

  async list(userId: string) {
    return this.prisma.userApiToken.findMany({
      where: { userId, revokedAt: null },
      select: { id: true, name: true, lastUsedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(userId: string, id: string): Promise<void> {
    await this.prisma.userApiToken.updateMany({
      where: { id, userId },
      data: { revokedAt: new Date() },
    });
  }
}
```

- [ ] **Step 4: app.module.ts の providers に登録**

`backend/src/app.module.ts`：`import { ApiKeyService } ...`（468行目付近）の隣に import を追加:

```ts
import { UserApiTokenService } from './infrastructure/services/user-api-token.service';
```

providers 配列内の `ApiKeyService,`（1107行目付近）の直後に:

```ts
    UserApiTokenService,
```

- [ ] **Step 5: テスト通過を確認**

Run: `cd ~/brain-pro/backend && npx jest src/infrastructure/services/user-api-token.service.spec.ts && npx tsc --noEmit`
Expected: PASS（5 tests）＋ tsc エラーなし。

- [ ] **Step 6: Commit**

```bash
cd ~/brain-pro && git add backend/src/infrastructure/services/user-api-token.service.ts backend/src/infrastructure/services/user-api-token.service.spec.ts backend/src/app.module.ts
git commit -m "feat(brainpro): UserApiTokenService（mint/resolve/list/revoke）＋provider登録"
```

---

### Task 4: `JwtAuthGuard` に user-api 経路を追加

**Files:**
- Modify: `backend/src/presentation/guards/jwt-auth.guard.ts`
- Test: `backend/src/presentation/guards/jwt-auth.user-api.spec.ts`

**Interfaces:**
- Consumes: `UserApiTokenService.resolve`（Task 3）／ `peekKind`（Task 2）。
- Produces: user-api JWT のリクエストで `request.user = { id: userId }`（apiKeyRole 無し）。

- [ ] **Step 1: 失敗するテストを書く**

`backend/src/presentation/guards/jwt-auth.user-api.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard (user-api token 経路)', () => {
  beforeAll(() => { process.env.BRAINPRO_API_JWT_SECRET = 'test-secret'; });

  const reflector = { getAllAndOverride: () => false } as any;
  const tokenService = { verifyToken: jest.fn() } as any;
  const prisma = {} as any;
  const apiKeyService = { hash: jest.fn() } as any; // sk_ 経路には入らない

  const ctxWith = (authorization: string, req: any = {}) =>
    ({ switchToHttp: () => ({ getRequest: () => (req.headers = { authorization }, req) }), getHandler: () => ({}), getClass: () => ({}) }) as any;

  it('有効な user-api トークンなら request.user={id} を載せ、apiKeyRole は付けない', async () => {
    const userApi = { resolve: jest.fn().mockResolvedValue({ userId: 'user-1' }) } as any;
    const guard = new JwtAuthGuard(tokenService, reflector, prisma, apiKeyService, userApi);
    // kind:"user-api" の本物の署名トークンを作る
    const { signUserApiJwt } = require('../../infrastructure/services/user-api-jwt');
    const token = signUserApiJwt({ userId: 'user-1', jti: 'tok-1' }, Math.floor(Date.now() / 1000));
    const req: any = {};
    await expect(guard.canActivate(ctxWith(`Bearer ${token}`, req))).resolves.toBe(true);
    expect(req.user).toEqual({ id: 'user-1' });
    expect(req.user.apiKeyRole).toBeUndefined();
  });

  it('resolve が null（失効/改竄）なら 401', async () => {
    const userApi = { resolve: jest.fn().mockResolvedValue(null) } as any;
    const guard = new JwtAuthGuard(tokenService, reflector, prisma, apiKeyService, userApi);
    const { signUserApiJwt } = require('../../infrastructure/services/user-api-jwt');
    const token = signUserApiJwt({ userId: 'user-1', jti: 'tok-1' }, Math.floor(Date.now() / 1000));
    await expect(guard.canActivate(ctxWith(`Bearer ${token}`))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('kind が無い（ログイン）JWT は user-api 経路に入らず TokenService に渡る', async () => {
    const userApi = { resolve: jest.fn() } as any;
    tokenService.verifyToken.mockReturnValue({ sub: 'u9', email: 'a@b.c' });
    const guard = new JwtAuthGuard(tokenService, reflector, prisma, apiKeyService, userApi);
    const req: any = {};
    await expect(guard.canActivate(ctxWith('Bearer login.jwt.here', req))).resolves.toBe(true);
    expect(userApi.resolve).not.toHaveBeenCalled();
    expect(req.user).toEqual({ id: 'u9', email: 'a@b.c' });
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `cd ~/brain-pro/backend && npx jest src/presentation/guards/jwt-auth.user-api.spec.ts`
Expected: FAIL（`JwtAuthGuard` は5引数コンストラクタでない／user-api 経路が無い）。

- [ ] **Step 3: ガードを拡張**

`backend/src/presentation/guards/jwt-auth.guard.ts`:

import 追加（`ApiKeyService` import の下）:

```ts
import { UserApiTokenService } from '../../infrastructure/services/user-api-token.service';
import { peekKind } from '../../infrastructure/services/user-api-jwt';
```

constructor に第5引数を追加:

```ts
  constructor(
    @Inject(TOKEN_SERVICE)
    private readonly tokenService: TokenService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly apiKeyService: ApiKeyService,
    private readonly userApiTokenService: UserApiTokenService,
  ) {}
```

`if (apiKey) { ... return true; }` ブロック（sk_ 経路・77行目付近）の**直後**、`// 2. JWT認証` の**手前**に挿入:

```ts
    // 1.5 ユーザー追従APIトークン（kind:"user-api" JWT）。sk_ でない Bearer JWT のうち、
    //     payload.kind==="user-api" のものだけをここで処理する（ログインJWTは kind 無し＝素通り）。
    const authForApi = request.headers.authorization;
    const bearerForApi =
      typeof authForApi === 'string' && authForApi.startsWith('Bearer ')
        ? authForApi.substring(7)
        : null;
    if (bearerForApi && peekKind(bearerForApi) === 'user-api') {
      const resolved = await this.userApiTokenService.resolve(bearerForApi, Date.now());
      if (!resolved) {
        throw new UnauthorizedException('Invalid or revoked API token');
      }
      // apiKeyRole を付けない＝ProjectAccessService がユーザーの会員RBACで認可（権限追従）。
      request.user = { id: resolved.userId };
      return true;
    }
```

- [ ] **Step 4: テスト通過を確認（既存ガードテストも壊れていないこと）**

Run: `cd ~/brain-pro/backend && npx jest src/presentation/guards && npx tsc --noEmit`
Expected: PASS（新 user-api 3 tests ＋ 既存 project-access.guard.spec.ts 群）＋ tsc エラーなし。

- [ ] **Step 5: Commit**

```bash
cd ~/brain-pro && git add backend/src/presentation/guards/jwt-auth.guard.ts backend/src/presentation/guards/jwt-auth.user-api.spec.ts
git commit -m "feat(brainpro): JwtAuthGuard に user-api トークン経路（userId のみ載せ＝権限追従・fail-closed）"
```

---

### Task 5: `UserApiTokenController`（`/api/user/api-tokens`）＋ controller 登録

**Files:**
- Create: `backend/src/presentation/controllers/user-api-token.controller.ts`
- Test: `backend/src/presentation/controllers/user-api-token.controller.spec.ts`
- Modify: `backend/src/app.module.ts`（controllers 配列・575行目 `ApiKeyController,` の隣）

**Interfaces:**
- Consumes: `UserApiTokenService`（Task 3）／ `@CurrentUser()`（`CurrentUserPayload { id, email, ... }`）。
- Produces: `POST /api/user/api-tokens {name}` → `{id,name,token,createdAt}`（token は1回だけ）／ `GET` → 一覧／ `DELETE /:id` → `{success:true}`。

- [ ] **Step 1: 失敗するテストを書く**

`backend/src/presentation/controllers/user-api-token.controller.spec.ts`:

```ts
import { UserApiTokenController } from './user-api-token.controller';

describe('UserApiTokenController', () => {
  const user = { id: 'user-1', email: 'a@b.c' } as any;
  const svc = {
    mint: jest.fn().mockResolvedValue({ id: 'tok-1', name: 'ipro', token: 'jwt.here.sig', createdAt: new Date(0) }),
    list: jest.fn().mockResolvedValue([{ id: 'tok-1', name: 'ipro', lastUsedAt: null, createdAt: new Date(0) }]),
    revoke: jest.fn().mockResolvedValue(undefined),
  } as any;
  const ctl = new UserApiTokenController(svc);

  it('create: 自分(user.id)名義で mint し、平文トークンを1回返す', async () => {
    const out = await ctl.create(user, { name: 'ipro' } as any);
    expect(svc.mint).toHaveBeenCalledWith('user-1', 'ipro', expect.any(Number));
    expect(out.token).toBe('jwt.here.sig');
  });

  it('list: 自分のトークンだけ（平文なし）', async () => {
    const out = await ctl.list(user);
    expect(svc.list).toHaveBeenCalledWith('user-1');
    expect(JSON.stringify(out)).not.toContain('token');
  });

  it('revoke: 自分(user.id)スコープで失効', async () => {
    const out = await ctl.revoke(user, 'tok-1');
    expect(svc.revoke).toHaveBeenCalledWith('user-1', 'tok-1');
    expect(out).toEqual({ success: true });
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `cd ~/brain-pro/backend && npx jest src/presentation/controllers/user-api-token.controller.spec.ts`
Expected: FAIL（`Cannot find module './user-api-token.controller'`）。

- [ ] **Step 3: コントローラを実装**

`backend/src/presentation/controllers/user-api-token.controller.ts`（`api-key.controller.ts` を簡素化してミラー）:

```ts
import { Controller, Get, Post, Delete, Body, Param, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { UserApiTokenService } from '../../infrastructure/services/user-api-token.service';
import { CurrentUser, CurrentUserPayload } from '../decorators/current-user.decorator';

class CreateUserApiTokenDto {
  @IsString()
  @MaxLength(100)
  name: string;
}

/**
 * ユーザー追従APIトークン（JWT）の自己管理。ログイン中のユーザーが自分名義のトークンを発行/一覧/失効する。
 * 発行したトークンは「自分の権限」で brain-pro API を叩ける（プロジェクトはユーザーの会員RBACに追従）。
 * 平文JWTは create のレスポンスでのみ返す。
 */
@ApiTags('APIトークン')
@ApiBearerAuth()
@Controller('user/api-tokens')
export class UserApiTokenController {
  constructor(@Inject(UserApiTokenService) private readonly svc: UserApiTokenService) {}

  @Post()
  @ApiOperation({ summary: 'ユーザー追従APIトークンを発行（平文JWTは一度だけ返却）' })
  async create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateUserApiTokenDto) {
    return this.svc.mint(user.id, dto.name, Date.now());
  }

  @Get()
  @ApiOperation({ summary: 'APIトークン一覧（平文は含まない）' })
  async list(@CurrentUser() user: CurrentUserPayload) {
    return this.svc.list(user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'APIトークンを失効' })
  async revoke(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.svc.revoke(user.id, id);
    return { success: true };
  }
}
```

- [ ] **Step 4: app.module.ts の controllers に登録**

import 追加（`import { ApiKeyController } ...` 411行目付近の隣）:

```ts
import { UserApiTokenController } from './presentation/controllers/user-api-token.controller';
```

controllers 配列内の `ApiKeyController,`（575行目付近）の直後に:

```ts
    UserApiTokenController,
```

- [ ] **Step 5: テスト通過＋ビルド確認**

Run: `cd ~/brain-pro/backend && npx jest src/presentation/controllers/user-api-token.controller.spec.ts && npx tsc --noEmit`
Expected: PASS（3 tests）＋ tsc エラーなし。

- [ ] **Step 6: Commit**

```bash
cd ~/brain-pro && git add backend/src/presentation/controllers/user-api-token.controller.ts backend/src/presentation/controllers/user-api-token.controller.spec.ts backend/src/app.module.ts
git commit -m "feat(brainpro): /api/user/api-tokens（自己管理: 発行/一覧/失効）"
```

---

### Task 6: 権限追従の回帰テスト（非会員は org 作成 403）

既存コード（`CreateProjectUseCase` が非会員に `ForbiddenError`、`GetOrganizationsUseCase` が `findByUserId`）が **ユーザー主体（user-api トークン）でも正しく効く**ことを固定する回帰テスト。新規プロダクションコードは無し。

**Files:**
- Create: `backend/src/application/use-cases/project/create-project.user-principal.spec.ts`

**Interfaces:**
- Consumes: `CreateProjectUseCase`（既存）。

- [ ] **Step 1: 既存 use-case の依存形状を確認**

Run: `cd ~/brain-pro/backend && sed -n '1,70p' src/application/use-cases/project/create-project.use-case.ts`
Expected: constructor の依存（organizationRepository / projectRepository 等）と、非会員時に `ForbiddenError('You are not a member of this organization')` を投げる行（45-49付近）を確認する。**この形状に合わせて次のテストの mock を書く**（下は代表形。実引数名が違えば合わせる）。

- [ ] **Step 2: 回帰テストを書く**

`backend/src/application/use-cases/project/create-project.user-principal.spec.ts`:

```ts
import { ForbiddenError } from '../../../domain';
import { CreateProjectUseCase } from './create-project.use-case';

/**
 * 権限追従の要（回帰）: user-api トークンは request.user={id} を載せるだけなので、認可は
 * この use-case の「発行ユーザーが org の会員か」チェックに帰着する。非会員 userId は 403。
 * ※ constructor 引数は create-project.use-case.ts の実形状に合わせること（Step 1）。
 */
describe('CreateProjectUseCase — ユーザー主体（権限追従）', () => {
  it('org の会員でない userId は ForbiddenError', async () => {
    const orgRepo = { isMember: jest.fn().mockResolvedValue(false) } as any; // 実メソッド名に合わせる
    const projectRepo = { existsBySlug: jest.fn(), create: jest.fn() } as any;
    // 実 constructor 順に合わせて new する（Step 1 で確認した引数順）。
    const uc = new CreateProjectUseCase(orgRepo, projectRepo);
    await expect(
      uc.execute({ userId: 'not-a-member', organizationId: 'org-1', name: 'X', slug: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(projectRepo.create).not.toHaveBeenCalled();
  });
});
```

> 実装メモ: Step 1 で読んだ constructor 引数・リポジトリのメソッド名（会員判定・slug 重複）に**必ず**合わせる。テストの目的は「非会員 userId が create に到達しない」ことの固定であり、mock 名はそれを満たす形にする。

- [ ] **Step 3: テスト通過を確認**

Run: `cd ~/brain-pro/backend && npx jest src/application/use-cases/project/create-project.user-principal.spec.ts`
Expected: PASS（1 test）。

- [ ] **Step 4: Commit**

```bash
cd ~/brain-pro && git add backend/src/application/use-cases/project/create-project.user-principal.spec.ts
git commit -m "test(brainpro): 権限追従の回帰（非会員userIdはプロジェクト作成403）"
```

---

### Task 7: フロントエンド `dashboard/settings` に「APIトークン」セクション

**Files:**
- Modify: `frontend/src/app/(dashboard)/dashboard/settings/page.tsx`

**Interfaces:**
- Consumes: `POST/GET/DELETE /api/user/api-tokens`（Task 5）。既存 sk_ APIキーUI（`apiKeys` 状態・`API_URL`・認証ヘッダ取得）と**同じfetch/認証機構**を流用。

- [ ] **Step 1: 既存の sk_ APIキー ハンドラを確認**

Run: `cd ~/brain-pro/frontend && grep -n "apiKeys\|/api-keys\|Authorization\|localStorage\|API_URL\|newKeyName\|issuedKey" "src/app/(dashboard)/dashboard/settings/page.tsx" | head -40`
Expected: 既存の「一覧取得」「発行」「失効」fetch と、認証トークンの載せ方（`Authorization: Bearer <ログインJWT>` をどこから取るか）を把握する。**新セクションは同じ機構を使う**。

- [ ] **Step 2: トークン用の state を追加**

`apiKeys` 状態群の近くに追記（型は Task 5 の GET レスポンス）:

```tsx
  // ユーザー追従APIトークン（JWT）。sk_ キーとは別枠。発行時だけ平文JWTが返る。
  const [apiTokens, setApiTokens] = useState<Array<{ id: string; name: string; lastUsedAt: string | null; createdAt: string }>>([]);
  const [newTokenName, setNewTokenName] = useState('');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [tokenBusy, setTokenBusy] = useState(false);
```

- [ ] **Step 3: load/create/revoke ハンドラを追加（既存 sk_ ハンドラと同じ認証機構で）**

既存の api-key ハンドラ（Step 1 で確認）と**同じ `fetch` 呼び出し形**を使う。エンドポイントだけ差し替える:

```tsx
  const loadApiTokens = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/user/api-tokens`, { headers: authHeaders() }); // authHeaders() は既存sk_呼び出しと同じ
    if (res.ok) setApiTokens(await res.json());
  }, []);

  const createApiToken = async () => {
    if (!newTokenName.trim()) return;
    setTokenBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/user/api-tokens`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTokenName.trim() }),
      });
      if (res.ok) {
        const j = await res.json();
        setIssuedToken(j.token); // 平文JWTは今だけ表示
        setNewTokenName('');
        await loadApiTokens();
      }
    } finally {
      setTokenBusy(false);
    }
  };

  const revokeApiToken = async (id: string) => {
    await fetch(`${API_URL}/api/user/api-tokens/${id}`, { method: 'DELETE', headers: authHeaders() });
    await loadApiTokens();
  };
```

> `authHeaders()` は既存 sk_ 呼び出しが使っているログインJWTの付与関数に置き換える（同ファイル内の実呼び出しに合わせる。無ければ既存 sk_ ハンドラのヘッダ組み立てをそのままコピー）。`useEffect` の初期ロードに `loadApiTokens()` を追加。

- [ ] **Step 4: UI（Card/セクション）を追加**

既存の「APIキー（sk_…）」Card の直後に、同じ `Card`/`Button`/`Input` で「APIトークン（ユーザー追従・JWT）」セクションを置く:

```tsx
      <Card>
        <CardHeader>
          <CardTitle>APIトークン（ユーザー追従・JWT）</CardTitle>
          <CardDescription>
            あなたの権限で外部連携（IPROくん等）から brain-pro を操作するトークン。触れるプロジェクトは
            あなたの現在の権限に追従します。発行時だけ平文が表示されます。失効するとそのトークンだけ即無効。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input placeholder="用途（例: IPROくん連携）" value={newTokenName} onChange={(e) => setNewTokenName(e.target.value)} />
            <Button onClick={createApiToken} disabled={tokenBusy || !newTokenName.trim()}>発行</Button>
          </div>
          {issuedToken && (
            <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm">
              <div className="font-medium">このトークンは今だけ表示されます。コピーして保管してください。</div>
              <code className="mt-1 block break-all">{issuedToken}</code>
              <Button variant="ghost" onClick={() => setIssuedToken(null)}>閉じる</Button>
            </div>
          )}
          <ul className="mt-3 space-y-1">
            {apiTokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between text-sm">
                <span>{t.name}<span className="ml-2 text-muted-foreground">{new Date(t.createdAt).toLocaleDateString()}</span></span>
                <Button variant="ghost" onClick={() => revokeApiToken(t.id)}>失効</Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
```

- [ ] **Step 5: ビルド確認**

Run: `cd ~/brain-pro/frontend && npx tsc --noEmit`（または `npm run build` が速ければそれ）
Expected: 型エラーなし。

- [ ] **Step 6: Commit**

```bash
cd ~/brain-pro && git add "frontend/src/app/(dashboard)/dashboard/settings/page.tsx"
git commit -m "feat(brainpro-frontend): dashboard/settings にユーザー追従APIトークンの発行/一覧/失効UI"
```

---

### Task 8: ipro-kun を Bearer 送信に切替＋文言

**Files:**
- Modify: `ipro-agent/core/brainpro.ts`（5か所: 18, 171, 200, 223, 244 行付近＋先頭コメント5行目）
- Modify: `ipro-agent/core/brainpro.test.ts`（ヘッダ検証があれば Bearer に更新）
- Modify: `ipro-ui/agent/BrainproLinksView.tsx` / `ipro-ui/agent/BrainproOrgForm.tsx`（文言）

**Interfaces:**
- Produces: brain-pro への全リクエストが `Authorization: Bearer <token>`。sk_ でも JWT でも動く（brain-pro が両方受理）。

- [ ] **Step 1: 既存テストの該当を確認**

Run: `cd ~/ipro-kun && grep -n "x-api-key\|Authorization\|Bearer" ipro-agent/core/brainpro.test.ts`
Expected: ヘッダを検証しているテストの有無を把握（あれば Step 4 で Bearer に直す）。

- [ ] **Step 2: `bp()` ヘルパのヘッダを差し替え（18行目）**

`ipro-agent/core/brainpro.ts` の `bp()` 内:

```ts
      "x-api-key": link.apiKey,
```
→
```ts
      Authorization: `Bearer ${link.apiKey}`,
```

- [ ] **Step 3: Raw 4関数のヘッダを差し替え（171/200/223/244）**

各 `headers: { "x-api-key": apiKey }` を `headers: { Authorization: \`Bearer ${apiKey}\` }` に。244 は content-type を残す:

```ts
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
```

先頭コメント（5行目）も更新:

```ts
// 認証は Bearer トークン（Authorization ヘッダ）。sk_ APIキーでも user-api JWT でも同じ Bearer で送る。
```

- [ ] **Step 4: テストを Bearer に更新**

Step 1 で見つかった `x-api-key` 検証を `Authorization: \`Bearer …\`` 期待に直す。ヘッダ検証が無ければこのステップは不要。

- [ ] **Step 5: UI 文言（sk_ 前提を緩める）**

`ipro-ui/agent/BrainproLinksView.tsx` の `KeyIssueHint` と `BrainproOrgForm.tsx` の APIキー説明に、「sk_ の APIキー、または brain-pro の《設定→APIトークン》で発行した**ユーザー追従トークン(JWT)**、どちらも使える」旨を1文追記（既存の発行先リンク `https://brain-pro.iplot.jp/dashboard/settings` はそのまま流用＝APIキーもトークンも同じ設定画面）。

- [ ] **Step 6: 型・テスト確認**

Run: `cd ~/ipro-kun && npx tsc --noEmit && npx vitest run ipro-agent/core/brainpro.test.ts`
Expected: tsc エラーなし＋ brainpro テスト緑。

- [ ] **Step 7: Commit**

```bash
cd ~/ipro-kun && git add ipro-agent/core/brainpro.ts ipro-agent/core/brainpro.test.ts ipro-ui/agent/BrainproLinksView.tsx ipro-ui/agent/BrainproOrgForm.tsx
git commit -m "feat(ipro-kun): brain-pro送信を Authorization: Bearer に統一（sk_/JWT両対応）＋文言"
```

---

## Self-Review

**1. Spec coverage:**
- §3 トークン形式 → Task 2（sign/verify・秒claims・kind）。✓
- §4.1 UserApiToken → Task 1。✓
- §4.2 発行（サービス/API/UI） → Task 3（service）/ Task 5（controller）/ Task 7（UI）。✓
- §4.3 Guard 検証 → Task 4。✓
- §4.4 認可（read-write・org作成メンバーシップ） → 既存 `resolveForPrincipal`（コード変更不要）＋ Task 6 で回帰固定。✓
- §5 ipro-kun 差し替え → Task 8。✓
- §6 後方互換（sk_共存） → Global Constraints＋Task 4 は sk_ 経路を触らない。✓
- §7 セキュリティ（fail-closed / timing-safe / 鍵分離 / 平文非保存 / lastUsedAt） → Task 2・3。✓
- BRAINPRO_API_JWT_SECRET ローカル書き出し → Task 2 Step 5。✓

**2. Placeholder scan:** Task 6・Task 7 は既存コードの実形状に合わせる指示を明示（「Step 1 で確認」）。これは無placeholder例外ではなく、既存パターン追従の正当な手順。他タスクは完全コードを掲載。✓

**3. Type consistency:** `signUserApiJwt`/`verifyUserApiJwt`/`peekKind`（Task 2）→ `UserApiTokenService.resolve/mint`（Task 3）→ Guard（Task 4）→ Controller（Task 5）で名称・引数一致。`request.user = { id }`（apiKeyRole 無し）を Task 4 と Global Constraints で統一。✓

---

## Notes

- **デプロイ順**: 本番は先に `BRAINPRO_API_JWT_SECRET` を brain-pro のデプロイ先 env に設定（ユーザー操作）→ migration 適用（既存の brain-pro デプロイ機構）→ push。未設定でも sk_ 経路は無影響（JWT発行/検証だけが 500/401 になる＝degrade）。
- ipro-kun 側は BRAINPRO_API_JWT_SECRET 不要（署名済みトークンを Bearer で運ぶだけ）。
