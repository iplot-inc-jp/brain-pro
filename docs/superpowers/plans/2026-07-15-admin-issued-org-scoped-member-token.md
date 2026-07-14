# 管理者によるメンバー用トークン発行（会社スコープ／Approach B）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** brain-pro の会社メンバー一覧で、会社管理者が各メンバー用のAPIトークン(JWT)を発行できるようにする。トークンは対象メンバー本人の権限で動くが、発行した会社の中だけに効く（会社スコープ／Approach B）。

**Architecture:** 既存の「ユーザー追従APIトークン(HS256 JWT)」の上に積む。スコープは JWT に載せず `user_api_tokens.scope_org_id` の行に持つ（失効と同じく DB が真実）。ガードが resolve 時に行から `scopeOrgId` を読んで `request.user` に載せ、以後2か所で効かせる:(1) 全プロジェクト/知識データの唯一の入口 `ProjectAccessService.resolveForPrincipal` で「対象案件の会社 ≠ scopeOrgId なら拒否」、(2) 会社管理系の `OrganizationController.assertCompanyAdmin` で越境拒否。self-service 発行（scope=null）は完全に不変。

**Tech Stack:** NestJS (backend) + Prisma + Next.js 14 (frontend)。テストは jest（backend colocated `*.spec.ts`）。HS256 JWT は既存 `user-api-jwt.ts` を使用（本タスクでは無改修）。

## Global Constraints

- 発行できるのは**会社管理者（OWNER/ADMIN）または全体管理者(super-admin)**のみ。
- 対象は**その会社のメンバー**のみ。**全体管理者(super-admin)を対象にした発行は禁止**（全社特権漏れ防止）。
- トークンは**対象メンバーの現在の権限に追従**（毎リクエスト live RBAC）。権限は JWT に載せない。
- **会社スコープ(B)**: 管理者発行トークンは発行会社にだけ効く。スコープは `user_api_tokens.scope_org_id`（DB行）に持つ。JWT の payload は既存のまま `{sub, jti, kind:"user-api", iat, exp}`（変更しない）。
- 発行・失効を**監査**: `issued_by_user_id` を記録し一覧表示する。
- 平文JWTは**発行時レスポンスで一度だけ**返す（DBに保存しない）。
- **self-service 経路（`/user/api-tokens`・`scope_org_id=null`）は完全に不変**（回帰させない）。
- fail-closed 継続（署名/期限/kind/jti行/revoked を既存どおり検証）。`scopeOrgId` は行＝失効即時反映。
- brain-pro 本番は `prisma db push`（`migrate` でない）でスキーマ同期する。**schema.prisma が唯一の真実**。migration ファイルはローカル/履歴の parity 用に併せて追加する。
- ipro 側は無変更。

---

### Task 1: DBスキーマ（scope_org_id / issued_by_user_id）

**Files:**
- Modify: `backend/prisma/schema.prisma:1290-1302`（`model UserApiToken`）
- Create: `backend/prisma/migrations/20260717000000_admin_issued_token_scope/migration.sql`

**Interfaces:**
- Consumes: 既存 `model UserApiToken`（id/userId/name/lastUsedAt/revokedAt/createdAt）。
- Produces: `UserApiToken` に nullable な `scopeOrgId @map("scope_org_id")` と `issuedByUserId @map("issued_by_user_id")` を追加し、`@@index([scopeOrgId])` を追加。Prisma Client の `userApiToken.create/findMany/findUnique/updateMany` がこの2カラムを受け付けるようになる。

- [ ] **Step 1: schema.prisma にカラムとインデックスを追加**

`backend/prisma/schema.prisma` の `model UserApiToken` を次の内容に置き換える（既存フィールドは変更しない・追加のみ）:

```prisma
model UserApiToken {
  id             String    @id @default(uuid())
  userId         String    @map("user_id")
  name           String
  lastUsedAt     DateTime? @map("last_used_at")
  revokedAt      DateTime? @map("revoked_at")
  createdAt      DateTime  @default(now()) @map("created_at")
  // 会社スコープ（管理者発行トークン）。null=自己発行の全社追従（従来どおり）。
  scopeOrgId     String?   @map("scope_org_id")
  // 監査: 管理者が発行した場合の発行者 userId。null=本人の自己発行。
  issuedByUserId String?   @map("issued_by_user_id")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([scopeOrgId])
  @@map("user_api_tokens")
}
```

- [ ] **Step 2: migration ファイルを作成**

`backend/prisma/migrations/20260717000000_admin_issued_token_scope/migration.sql`:

```sql
-- 管理者によるメンバー用トークン発行（会社スコープ／Approach B）。
-- scope_org_id: 発行会社に限定するスコープ（null=自己発行の全社追従・従来どおり）。
-- issued_by_user_id: 監査用の発行者 userId（null=本人の自己発行）。
ALTER TABLE "user_api_tokens" ADD COLUMN "scope_org_id" TEXT;
ALTER TABLE "user_api_tokens" ADD COLUMN "issued_by_user_id" TEXT;

CREATE INDEX "user_api_tokens_scope_org_id_idx" ON "user_api_tokens"("scope_org_id");
```

- [ ] **Step 3: Prisma Client を再生成して型を反映**

Run: `cd backend && npx prisma generate`
Expected: 成功（`Generated Prisma Client`）。以後 `userApiToken` の型に `scopeOrgId` / `issuedByUserId` が現れる。

- [ ] **Step 4: 既存の user-api-token テストが緑のまま（回帰なし）を確認**

Run: `cd backend && npx jest src/infrastructure/services/user-api-token.service.spec.ts`
Expected: PASS（5 tests）。既存 self-service の挙動が不変であることを確認。

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260717000000_admin_issued_token_scope/migration.sql
git commit -m "feat(brainpro): user_api_tokens に scope_org_id/issued_by_user_id を追加（会社スコープ/監査）"
```

---

### Task 2: UserApiTokenService（mint opts / resolve 拡張 / org スコープ list・revoke）

**Files:**
- Modify: `backend/src/infrastructure/services/user-api-token.service.ts`
- Test: `backend/src/infrastructure/services/user-api-token.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 の `userApiToken.scopeOrgId` / `issuedByUserId` カラム。既存 `signUserApiJwt({userId, jti}, iatSec)`、`verifyUserApiJwt(token, nowSec)`（無改修）。
- Produces:
  - `mint(userId: string, name: string, nowMs: number, opts?: { scopeOrgId?: string; issuedByUserId?: string }): Promise<{ id: string; name: string; token: string; createdAt: Date }>`
  - `resolve(token: string, nowMs: number): Promise<{ userId: string; scopeOrgId: string | null } | null>`（返り値に `scopeOrgId` を追加）
  - `listForOrgMember(userId: string, orgId: string): Promise<{ id: string; name: string; lastUsedAt: Date | null; createdAt: Date; issuedByUserId: string | null }[]>`
  - `revokeForOrgMember(userId: string, orgId: string, tokenId: string): Promise<void>`
  - 既存 `list(userId)` / `revoke(userId, id)` は不変。

- [ ] **Step 1: 失敗するテストを追加**

`backend/src/infrastructure/services/user-api-token.service.spec.ts` の `describe` 末尾（`revoke:` の it の後）に追記する。まずファイル冒頭の `makePrisma` を、新メソッドが使う `findMany`/`updateMany` の引数を検証できるよう既存のまま利用しつつ、以下の it を追加:

```typescript
  it('mint: opts で scopeOrgId / issuedByUserId を行に保存する', async () => {
    const prisma = makePrisma(null);
    const svc = new UserApiTokenService(prisma);
    await svc.mint('member-1', 'admin-issued', NOW, { scopeOrgId: 'org-9', issuedByUserId: 'admin-1' });
    expect(prisma.userApiToken.create).toHaveBeenCalledWith({
      data: { userId: 'member-1', name: 'admin-issued', scopeOrgId: 'org-9', issuedByUserId: 'admin-1' },
    });
  });

  it('resolve: 返り値に scopeOrgId を含む（行の値）', async () => {
    const prisma = makePrisma(null);
    const { token } = await new UserApiTokenService(prisma).mint('member-1', 't', NOW);
    const prismaScoped = makePrisma({ id: 'tok-1', userId: 'member-1', revokedAt: null, scopeOrgId: 'org-9' });
    expect(await new UserApiTokenService(prismaScoped).resolve(token, NOW)).toEqual({
      userId: 'member-1',
      scopeOrgId: 'org-9',
    });
  });

  it('resolve: self-service 行（scopeOrgId 無し）は scopeOrgId:null を返す', async () => {
    const prisma = makePrisma(null);
    const { token } = await new UserApiTokenService(prisma).mint('member-1', 't', NOW);
    const prismaSelf = makePrisma({ id: 'tok-1', userId: 'member-1', revokedAt: null, scopeOrgId: null });
    expect(await new UserApiTokenService(prismaSelf).resolve(token, NOW)).toEqual({
      userId: 'member-1',
      scopeOrgId: null,
    });
  });

  it('listForOrgMember: userId かつ scopeOrgId かつ未失効に限定して引く', async () => {
    const prisma = makePrisma(null);
    await new UserApiTokenService(prisma).listForOrgMember('member-1', 'org-9');
    expect(prisma.userApiToken.findMany).toHaveBeenCalledWith({
      where: { userId: 'member-1', scopeOrgId: 'org-9', revokedAt: null },
      select: { id: true, name: true, lastUsedAt: true, createdAt: true, issuedByUserId: true },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('revokeForOrgMember: id/userId/scopeOrgId 全一致だけ失効（他会社・他人は消せない）', async () => {
    const prisma = makePrisma(null);
    await new UserApiTokenService(prisma).revokeForOrgMember('member-1', 'org-9', 'tok-1');
    expect(prisma.userApiToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'tok-1', userId: 'member-1', scopeOrgId: 'org-9' },
      data: { revokedAt: expect.any(Date) },
    });
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd backend && npx jest src/infrastructure/services/user-api-token.service.spec.ts`
Expected: FAIL（新 it が「`listForOrgMember is not a function`」「resolve が `{userId}` のみ返す」等で落ちる）。

- [ ] **Step 3: 実装を更新**

`backend/src/infrastructure/services/user-api-token.service.ts` の `mint` / `resolve` を差し替え、`listForOrgMember` / `revokeForOrgMember` を追加する（`list` / `revoke` はそのまま残す）:

```typescript
  async mint(
    userId: string,
    name: string,
    nowMs: number,
    opts?: { scopeOrgId?: string; issuedByUserId?: string },
  ): Promise<{ id: string; name: string; token: string; createdAt: Date }> {
    const data: {
      userId: string;
      name: string;
      scopeOrgId?: string;
      issuedByUserId?: string;
    } = { userId, name };
    if (opts?.scopeOrgId) data.scopeOrgId = opts.scopeOrgId;
    if (opts?.issuedByUserId) data.issuedByUserId = opts.issuedByUserId;
    const record = await this.prisma.userApiToken.create({ data });
    const token = signUserApiJwt({ userId, jti: record.id }, Math.floor(nowMs / 1000));
    return { id: record.id, name: record.name, token, createdAt: record.createdAt };
  }

  async resolve(
    token: string,
    nowMs: number,
  ): Promise<{ userId: string; scopeOrgId: string | null } | null> {
    const claims = verifyUserApiJwt(token, Math.floor(nowMs / 1000));
    if (!claims) return null;
    const row = await this.prisma.userApiToken.findUnique({ where: { id: claims.jti } });
    if (!row || row.revokedAt) return null;
    if (row.userId !== claims.sub) return null;
    // 監査。失敗しても認証は継続。
    void this.prisma.userApiToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date(nowMs) } })
      .catch(() => undefined);
    return { userId: row.userId, scopeOrgId: row.scopeOrgId ?? null };
  }
```

そして `revoke(...)` の後に追加:

```typescript
  /** 会社管理者UI用: 対象メンバー(userId)の、この会社(orgId)スコープのトークンだけを一覧。 */
  async listForOrgMember(userId: string, orgId: string) {
    return this.prisma.userApiToken.findMany({
      where: { userId, scopeOrgId: orgId, revokedAt: null },
      select: { id: true, name: true, lastUsedAt: true, createdAt: true, issuedByUserId: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 会社管理者UI用: 対象メンバーの、この会社スコープのトークンだけを失効（越境不可）。 */
  async revokeForOrgMember(userId: string, orgId: string, tokenId: string): Promise<void> {
    await this.prisma.userApiToken.updateMany({
      where: { id: tokenId, userId, scopeOrgId: orgId },
      data: { revokedAt: new Date() },
    });
  }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd backend && npx jest src/infrastructure/services/user-api-token.service.spec.ts`
Expected: PASS（既存5 + 追加5 = 10 tests）。

- [ ] **Step 5: Commit**

```bash
git add backend/src/infrastructure/services/user-api-token.service.ts backend/src/infrastructure/services/user-api-token.service.spec.ts
git commit -m "feat(brainpro): UserApiTokenService に会社スコープ発行/解決/一覧/失効を追加"
```

---

### Task 3: 認証ガードが scopeOrgId を request.user に載せる

**Files:**
- Modify: `backend/src/presentation/guards/jwt-auth.guard.ts:89-97`
- Modify: `backend/src/presentation/decorators/current-user.decorator.ts:7-18`（`CurrentUserPayload` に `scopeOrgId?`）

**Interfaces:**
- Consumes: Task 2 の `resolve()` が返す `{ userId, scopeOrgId }`。
- Produces: user-api トークン認証時、`request.user = { id, scopeOrgId }`。`CurrentUserPayload` に `scopeOrgId?: string | null` が追加され、下流（controller / principal）が読めるようになる。

- [ ] **Step 1: 失敗するテストを追加**

`backend/src/presentation/guards/jwt-auth.guard.spec.ts` が無ければ作成、あれば追記する。まず存在確認: `ls backend/src/presentation/guards/jwt-auth.guard.spec.ts`。無い場合は新規作成し、user-api 分岐が `scopeOrgId` を request.user に載せることを検証する:

```typescript
import { JwtAuthGuard } from './jwt-auth.guard';

// peekKind が 'user-api' を返すトークンを resolve に流し、request.user に scopeOrgId が載るか検証。
describe('JwtAuthGuard user-api branch', () => {
  const makeCtx = (headers: Record<string, string>, req: any = {}) => {
    req.headers = headers;
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
  };

  it('user-api JWT を解決したら request.user に id と scopeOrgId を載せる', async () => {
    const reflector = { getAllAndOverride: () => false } as any;
    const prisma = { apiKey: { findUnique: jest.fn() } } as any;
    const apiKeyService = { hash: jest.fn() } as any;
    // peekKind は 'user-api.' 形式のダミーJWTで判定される。resolve をスタブして scopeOrgId を返す。
    const userApiTokenService = {
      resolve: jest.fn().mockResolvedValue({ userId: 'member-1', scopeOrgId: 'org-9' }),
    } as any;
    const tokenService = { verifyToken: jest.fn() } as any;
    const guard = new JwtAuthGuard(tokenService, reflector, prisma, apiKeyService, userApiTokenService);

    // peekKind が 'user-api' を返すよう、payload に kind:"user-api" を持つ本物構造のトークンを作る。
    const payload = Buffer.from(JSON.stringify({ kind: 'user-api', sub: 'member-1', jti: 'tok-1' })).toString('base64url');
    const jwt = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${payload}.sig`;
    const req: any = {};
    const ok = await guard.canActivate(makeCtx({ authorization: `Bearer ${jwt}` }, req));

    expect(ok).toBe(true);
    expect(req.user).toEqual({ id: 'member-1', scopeOrgId: 'org-9' });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd backend && npx jest src/presentation/guards/jwt-auth.guard.spec.ts`
Expected: FAIL（`req.user` が `{ id: 'member-1' }` で `scopeOrgId` が無い）。

- [ ] **Step 3: 実装を更新**

`backend/src/presentation/guards/jwt-auth.guard.ts` の user-api 分岐（89-97行）を差し替える:

```typescript
    if (bearerForApi && peekKind(bearerForApi) === 'user-api') {
      const resolved = await this.userApiTokenService.resolve(bearerForApi, Date.now());
      if (!resolved) {
        throw new UnauthorizedException('Invalid or revoked API token');
      }
      // apiKeyRole を付けない＝ProjectAccessService がユーザーの会員RBACで認可（権限追従）。
      // scopeOrgId があれば「発行会社にだけ効く」制約が resolveForPrincipal / assertCompanyAdmin で適用される。
      request.user = { id: resolved.userId, scopeOrgId: resolved.scopeOrgId ?? null };
      return true;
    }
```

`backend/src/presentation/decorators/current-user.decorator.ts` の `CurrentUserPayload` に `scopeOrgId` を追加する（`projectIds?` の後）:

```typescript
  // GENERAL_USER キーが紐付く全プロジェクト（複数可）。空/未設定なら projectId（単一）にフォールバック。
  projectIds?: string[] | null;
  // 会社スコープ（管理者発行の user-api トークン）。null/undefined=全社追従（従来どおり）。
  scopeOrgId?: string | null;
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd backend && npx jest src/presentation/guards/jwt-auth.guard.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/src/presentation/guards/jwt-auth.guard.ts backend/src/presentation/decorators/current-user.decorator.ts backend/src/presentation/guards/jwt-auth.guard.spec.ts
git commit -m "feat(brainpro): user-api トークン認証時に scopeOrgId を request.user に載せる"
```

---

### Task 4: resolveForPrincipal の越境拒否＋ガード build site

**Files:**
- Modify: `backend/src/infrastructure/services/project-access.service.ts:19-25`（`AccessPrincipal`）, `:153-170`（`resolveForPrincipal`）
- Modify: `backend/src/presentation/guards/project-access.guard.ts:41-73`（build site が `scopeOrgId` を渡す）
- Test: `backend/src/infrastructure/services/project-access.service.spec.ts`（新規）

**Interfaces:**
- Consumes: Task 3 で `request.user.scopeOrgId` が載る。既存 `resolveProjectAccess(projectId, userId)`、`resolveApiKeyProjectAccess(scope, projectId)`。
- Produces: `AccessPrincipal` に `scopeOrgId?: string | null`。`resolveForPrincipal` はユーザー経路の先頭で「`scopeOrgId` があり対象プロジェクトの会社と不一致なら null（越境拒否）」を判定してから従来の live RBAC に進む。ProjectAccessGuard は build site で `scopeOrgId: user.scopeOrgId ?? null` を渡す。

- [ ] **Step 1: 失敗するテストを新規作成**

`backend/src/infrastructure/services/project-access.service.spec.ts`:

```typescript
import { ProjectAccessService } from './project-access.service';

// resolveForPrincipal の会社スコープ挙動を、prisma をモックして検証する。
describe('ProjectAccessService.resolveForPrincipal (scopeOrgId)', () => {
  // project.organizationId を返し、super-admin でない一般会員(EDIT)を模す最小モック。
  const makePrisma = (projectOrgId: string) =>
    ({
      project: { findUnique: jest.fn().mockResolvedValue({ organizationId: projectOrgId }) },
      user: { findUnique: jest.fn().mockResolvedValue({ isSuperAdmin: false }) },
      organizationMember: { findUnique: jest.fn().mockResolvedValue({ role: 'MEMBER' }) },
      projectMember: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    }) as any;

  it('scopeOrgId 一致: 本人の live RBAC で解決（org メンバー→EDIT）', async () => {
    const svc = new ProjectAccessService(makePrisma('org-9'));
    const level = await svc.resolveForPrincipal({ id: 'member-1', scopeOrgId: 'org-9' }, 'proj-1');
    expect(level).toBe('EDIT');
  });

  it('scopeOrgId 不一致: 対象案件が別会社なら null（越境拒否・RBAC を見ない）', async () => {
    const prisma = makePrisma('org-OTHER');
    const svc = new ProjectAccessService(prisma);
    const level = await svc.resolveForPrincipal({ id: 'member-1', scopeOrgId: 'org-9' }, 'proj-1');
    expect(level).toBe(null);
    // 越境時は会員 RBAC の照会に進まない（早期 deny）。
    expect(prisma.organizationMember.findUnique).not.toHaveBeenCalled();
  });

  it('scopeOrgId 無し: 従来どおり本人の RBAC（自己発行トークン/ログインユーザー）', async () => {
    const svc = new ProjectAccessService(makePrisma('org-9'));
    const level = await svc.resolveForPrincipal({ id: 'member-1' }, 'proj-1');
    expect(level).toBe('EDIT');
  });

  it('存在しないプロジェクトは null', async () => {
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any;
    const svc = new ProjectAccessService(prisma);
    expect(await svc.resolveForPrincipal({ id: 'member-1', scopeOrgId: 'org-9' }, 'nope')).toBe(null);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd backend && npx jest src/infrastructure/services/project-access.service.spec.ts`
Expected: FAIL（型に `scopeOrgId` が無い / 不一致でも EDIT を返す）。

- [ ] **Step 3: AccessPrincipal と resolveForPrincipal を更新**

`backend/src/infrastructure/services/project-access.service.ts` の `AccessPrincipal`（19-25行）に `scopeOrgId` を追加:

```typescript
export interface AccessPrincipal {
  id: string;
  apiKeyRole?: ApiKeyRole | null;
  organizationId?: string | null;
  projectId?: string | null;
  projectIds?: string[] | null;
  // 会社スコープ（管理者発行の user-api トークン）。あれば対象プロジェクトの会社と一致必須（越境拒否）。
  scopeOrgId?: string | null;
}
```

`resolveForPrincipal`（153-170行）を差し替える:

```typescript
  async resolveForPrincipal(
    principal: AccessPrincipal,
    targetProjectId: string,
  ): Promise<ProjectAccessLevelValue | null> {
    if (principal.apiKeyRole && principal.organizationId) {
      return this.resolveApiKeyProjectAccess(
        {
          apiKeyRole: principal.apiKeyRole,
          organizationId: principal.organizationId,
          projectId: principal.projectId ?? null,
          projectIds: principal.projectIds ?? null,
        },
        targetProjectId,
      );
    }
    // 会社スコープ（管理者発行トークン）: 対象プロジェクトの会社が scopeOrgId と違えば越境拒否。
    // ここで先に弾くことで、以降の live RBAC は「発行会社のプロジェクト」だけに効く。
    if (principal.scopeOrgId) {
      const project = await this.prisma.project.findUnique({
        where: { id: targetProjectId },
        select: { organizationId: true },
      });
      if (!project || project.organizationId !== principal.scopeOrgId) return null;
    }
    // 通常ユーザー、または organization 未設定の旧APIキー（発行者権限にフォールバック）。
    return this.resolveProjectAccess(targetProjectId, principal.id);
  }
```

- [ ] **Step 4: ProjectAccessGuard の build site が scopeOrgId を渡すよう更新**

`backend/src/presentation/guards/project-access.guard.ts` の local `user` 型（41-49行）に `scopeOrgId` を追加:

```typescript
    const user = request.user as
      | {
          id?: string;
          apiKeyRole?: ApiKeyRole;
          organizationId?: string | null;
          projectId?: string | null;
          projectIds?: string[] | null;
          scopeOrgId?: string | null;
        }
      | undefined;
```

`resolveForPrincipal` 呼び出し（63-73行）に `scopeOrgId` を追加:

```typescript
    const level = await this.projectAccess.resolveForPrincipal(
      {
        id: user.id,
        apiKeyRole: user.apiKeyRole ?? null,
        organizationId: user.organizationId ?? null,
        projectId: user.projectId ?? null,
        // 複数プロジェクト紐付けキーの全対象を渡す（これを落とすと先頭プロジェクト以外が 403 になる）。
        projectIds: user.projectIds ?? null,
        // 管理者発行トークンの会社スコープ（越境拒否）。
        scopeOrgId: user.scopeOrgId ?? null,
      },
      projectId,
    );
```

（注: `meeting-occurrence.controller.ts` は principal を `CurrentUserPayload` のまま `assertPrincipalAccess` に渡すので、Task 3 で `scopeOrgId` が payload に載れば自動で伝播する。追加変更は不要。）

- [ ] **Step 5: テストが通ることを確認**

Run: `cd backend && npx jest src/infrastructure/services/project-access.service.spec.ts src/presentation/guards/project-access.guard.spec.ts`
Expected: PASS（新 service spec 4 tests＋既存 guard spec が緑）。

- [ ] **Step 6: Commit**

```bash
git add backend/src/infrastructure/services/project-access.service.ts backend/src/infrastructure/services/project-access.service.spec.ts backend/src/presentation/guards/project-access.guard.ts
git commit -m "feat(brainpro): 管理者発行トークンの会社スコープ越境拒否を resolveForPrincipal に実装"
```

---

### Task 5: assertCompanyAdmin に会社スコープ検査を追加

**Files:**
- Modify: `backend/src/presentation/controllers/organization.controller.ts:101-119`（`assertCompanyAdmin` の引数を `userId` → `user` に変更＋スコープ検査）, および呼び出し6か所（160, 183, 222, 246, 317, 370）
- Test: `backend/src/presentation/controllers/organization.controller.spec.ts`（新規）

**Interfaces:**
- Consumes: Task 3 の `CurrentUserPayload.scopeOrgId`。既存 `ForbiddenError`。
- Produces: `private async assertCompanyAdmin(organizationId: string, user: CurrentUserPayload): Promise<void>`。先頭で `scopeOrgId` が要求 org と違えば `ForbiddenError`。呼び出しは全て `assertCompanyAdmin(id, user)`。

- [ ] **Step 1: 失敗するテストを新規作成**

`backend/src/presentation/controllers/organization.controller.spec.ts`:

```typescript
import { OrganizationController } from './organization.controller';
import { ForbiddenError } from '../../domain';

// assertCompanyAdmin は private。スコープ検査ブランチは DB 照会前に throw するので、
// getMembers を「別会社スコープのトークン」で呼ぶと prisma に触れず Forbidden になることで検証する。
describe('OrganizationController scope gate', () => {
  const makeController = () => {
    const prisma = {
      user: { findUnique: jest.fn() },
      organizationMember: { findUnique: jest.fn(), findMany: jest.fn() },
    } as any;
    const ctrl = new OrganizationController(
      {} as any, // CreateOrganizationUseCase
      {} as any, // GetOrganizationsUseCase
      prisma,
      {} as any, // CryptoService
      {} as any, // PasswordHashService
    );
    return { ctrl, prisma };
  };

  it('別会社スコープのトークンは Forbidden（DB照会前に弾く）', async () => {
    const { ctrl, prisma } = makeController();
    const user = { id: 'member-1', email: '', scopeOrgId: 'org-OTHER' } as any;
    await expect(ctrl.getMembers(user, 'org-9')).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('自社スコープのトークンはスコープ検査を通過し通常の管理者判定に進む（非管理者は Forbidden）', async () => {
    const { ctrl, prisma } = makeController();
    prisma.user.findUnique.mockResolvedValue({ isSuperAdmin: false });
    prisma.organizationMember.findUnique.mockResolvedValue({ role: 'MEMBER' }); // 非管理者
    const user = { id: 'member-1', email: '', scopeOrgId: 'org-9' } as any;
    await expect(ctrl.getMembers(user, 'org-9')).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.user.findUnique).toHaveBeenCalled(); // スコープは通過して管理者判定に進んだ
  });

  it('スコープ無しトークン/ログインユーザーは従来どおり（管理者なら通過）', async () => {
    const { ctrl, prisma } = makeController();
    prisma.user.findUnique.mockResolvedValue({ isSuperAdmin: false });
    prisma.organizationMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    prisma.organizationMember.findMany.mockResolvedValue([]);
    const user = { id: 'admin-1', email: '' } as any; // scopeOrgId 無し
    await expect(ctrl.getMembers(user, 'org-9')).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd backend && npx jest src/presentation/controllers/organization.controller.spec.ts`
Expected: FAIL（現行 `assertCompanyAdmin(id, user.id)` は `user` を受け取らず scope 検査が無い）。

- [ ] **Step 3: assertCompanyAdmin を更新し呼び出しを差し替え**

`backend/src/presentation/controllers/organization.controller.ts` の `assertCompanyAdmin`（101-119行）を差し替える:

```typescript
  // 会社管理者（OWNER/ADMIN）または全体管理者か検証。
  // 管理者発行トークン(scopeOrgId 付き)は発行会社以外の管理操作を拒否（越境防止）。
  private async assertCompanyAdmin(
    organizationId: string,
    user: CurrentUserPayload,
  ): Promise<void> {
    // 会社スコープトークン: 対象会社が違えば即拒否（DB照会不要）。
    if (user.scopeOrgId && user.scopeOrgId !== organizationId) {
      throw new ForbiddenError('この会社を管理する権限がありません');
    }
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { isSuperAdmin: true },
    });
    if (dbUser?.isSuperAdmin) return;

    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: user.id } },
      select: { role: true },
    });
    if (member && (member.role === 'OWNER' || member.role === 'ADMIN')) {
      return;
    }
    throw new ForbiddenError('この会社を管理する権限がありません');
  }
```

続いて呼び出し6か所を `this.assertCompanyAdmin(id, user.id)` → `this.assertCompanyAdmin(id, user)` に変更する（`getSettings` 160行, `updateSettings` 183行, `getMembers` 222行, `addMember` 246行, `updateMember` 317行, `removeMember` 370行）。各ハンドラは既に `@CurrentUser() user: CurrentUserPayload` を受けているのでそのまま渡せる。

Run（機械的置換の確認）: `cd backend && grep -n "assertCompanyAdmin(id, user" src/presentation/controllers/organization.controller.ts`
Expected: 6行すべて `assertCompanyAdmin(id, user)`（`.id` が付いていない）。

- [ ] **Step 4: テストが通ることを確認**

Run: `cd backend && npx jest src/presentation/controllers/organization.controller.spec.ts`
Expected: PASS（3 tests）。

- [ ] **Step 5: Commit**

```bash
git add backend/src/presentation/controllers/organization.controller.ts backend/src/presentation/controllers/organization.controller.spec.ts
git commit -m "feat(brainpro): assertCompanyAdmin に会社スコープ検査を追加（管理系の越境防止）"
```

---

### Task 6: OrganizationController 発行/一覧/失効エンドポイント

**Files:**
- Modify: `backend/src/presentation/controllers/organization.controller.ts`（DTO追加、`UserApiTokenService` を DI、3エンドポイント追加）
- Modify: `backend/src/presentation/controllers/organization.controller.spec.ts`（Task 5 で作成したファイルに追記）

**Interfaces:**
- Consumes: Task 2 の `UserApiTokenService.mint(userId, name, nowMs, { scopeOrgId, issuedByUserId })` / `listForOrgMember(userId, orgId)` / `revokeForOrgMember(userId, orgId, tokenId)`。Task 5 の `assertCompanyAdmin(id, user)`。
- Produces: 3ルート（すべて `assertCompanyAdmin` ＋ 対象メンバー確認 ＋ super-admin対象禁止）:
  - `POST organizations/:id/members/:userId/api-tokens` body `{ name }` → `{ id, name, token, createdAt }`（平文JWTは1回だけ）
  - `GET organizations/:id/members/:userId/api-tokens` → `{ id, name, lastUsedAt, createdAt, issuedByUserId, issuedByName }[]`
  - `DELETE organizations/:id/members/:userId/api-tokens/:tokenId` → `{ success: true }`

- [ ] **Step 1: 失敗するテストを追記**

`organization.controller.spec.ts` に、発行エンドポイントの認可（非管理者403 / 非メンバー対象403 / super-admin対象403 / 正常発行）を検証する describe を追加する。`UserApiTokenService` を6番目の引数として DI するため `makeController` を更新する:

```typescript
import { UserApiTokenService } from '../../infrastructure/services/user-api-token.service';

describe('OrganizationController member api-tokens', () => {
  const makeController = () => {
    const prisma = {
      user: { findUnique: jest.fn() },
      organizationMember: { findUnique: jest.fn() },
    } as any;
    const tokenSvc = {
      mint: jest.fn().mockResolvedValue({ id: 'tok-1', name: 'ipro', token: 'a.b.c', createdAt: new Date(0) }),
      listForOrgMember: jest.fn().mockResolvedValue([]),
      revokeForOrgMember: jest.fn().mockResolvedValue(undefined),
    };
    const ctrl = new OrganizationController(
      {} as any,
      {} as any,
      prisma,
      {} as any,
      {} as any,
      tokenSvc as any,
    );
    return { ctrl, prisma, tokenSvc };
  };

  // 管理者本人（admin-1 が org-9 の OWNER・super-admin でない）を模す共通セットアップ。
  const asAdmin = (prisma: any) => {
    prisma.user.findUnique.mockImplementation(({ where, select }: any) => {
      // assertCompanyAdmin の isSuperAdmin 照会
      if (select?.isSuperAdmin) return Promise.resolve({ isSuperAdmin: where.id === 'admin-1' ? false : false });
      return Promise.resolve(null);
    });
    prisma.organizationMember.findUnique.mockImplementation(({ where }: any) => {
      const uid = where.organizationId_userId.userId;
      if (uid === 'admin-1') return Promise.resolve({ role: 'OWNER' }); // 発行者は管理者
      if (uid === 'member-1') return Promise.resolve({ role: 'MEMBER' }); // 対象は会社メンバー
      return Promise.resolve(null); // それ以外は非メンバー
    });
  };

  const admin = { id: 'admin-1', email: '' } as any;

  it('非管理者は発行できない（403）', async () => {
    const { ctrl, prisma } = makeController();
    prisma.user.findUnique.mockResolvedValue({ isSuperAdmin: false });
    prisma.organizationMember.findUnique.mockResolvedValue({ role: 'MEMBER' }); // 呼び出し元が非管理者
    const notAdmin = { id: 'member-2', email: '' } as any;
    await expect(
      ctrl.issueMemberApiToken(notAdmin, 'org-9', 'member-1', { name: 'ipro' }),
    ).rejects.toBeDefined();
  });

  it('対象が会社メンバーでなければ拒否', async () => {
    const { ctrl, prisma } = makeController();
    asAdmin(prisma);
    // 対象 outsider は org-9 の非メンバー
    await expect(
      ctrl.issueMemberApiToken(admin, 'org-9', 'outsider', { name: 'ipro' }),
    ).rejects.toBeDefined();
  });

  it('対象が super-admin なら発行禁止', async () => {
    const { ctrl, prisma, tokenSvc } = makeController();
    asAdmin(prisma);
    // 対象 member-1 は org-9 のメンバーだが super-admin
    prisma.user.findUnique.mockImplementation(({ where, select }: any) => {
      if (select?.isSuperAdmin) return Promise.resolve({ isSuperAdmin: where.id === 'member-1' });
      return Promise.resolve(null);
    });
    await expect(
      ctrl.issueMemberApiToken(admin, 'org-9', 'member-1', { name: 'ipro' }),
    ).rejects.toBeDefined();
    expect(tokenSvc.mint).not.toHaveBeenCalled();
  });

  it('正常: scopeOrgId と issuedByUserId を付けて mint し、平文トークンを返す', async () => {
    const { ctrl, prisma, tokenSvc } = makeController();
    asAdmin(prisma);
    const out = await ctrl.issueMemberApiToken(admin, 'org-9', 'member-1', { name: 'ipro' });
    expect(tokenSvc.mint).toHaveBeenCalledWith('member-1', 'ipro', expect.any(Number), {
      scopeOrgId: 'org-9',
      issuedByUserId: 'admin-1',
    });
    expect(out.token).toBe('a.b.c');
  });

  it('失効: revokeForOrgMember に (対象, 会社, tokenId) を渡す', async () => {
    const { ctrl, prisma, tokenSvc } = makeController();
    asAdmin(prisma);
    await ctrl.revokeMemberApiToken(admin, 'org-9', 'member-1', 'tok-1');
    expect(tokenSvc.revokeForOrgMember).toHaveBeenCalledWith('member-1', 'org-9', 'tok-1');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd backend && npx jest src/presentation/controllers/organization.controller.spec.ts`
Expected: FAIL（`issueMemberApiToken` / `revokeMemberApiToken` が未定義、コンストラクタが6番目の引数を取らない）。

- [ ] **Step 3: DTO・DI・エンドポイントを実装**

`organization.controller.ts` の import に `UserApiTokenService` を追加:

```typescript
import { UserApiTokenService } from '../../infrastructure/services/user-api-token.service';
```

DTO を（`UpdateMemberDto` の後に）追加:

```typescript
class IssueMemberApiTokenDto {
  @IsString()
  name: string;
}
```

コンストラクタに DI を追加（既存引数の後に追記）:

```typescript
    @Inject(PASSWORD_HASH_SERVICE)
    private readonly passwordHashService: PasswordHashService,
    private readonly userApiTokenService: UserApiTokenService,
  ) {}
```

対象メンバー確認＋super-admin対象禁止を行う private ヘルパと3エンドポイントを、クラス末尾（`removeMember` の後）に追加:

```typescript
  // 発行/一覧/失効の対象メンバーを検証: この会社のメンバーであること・super-admin でないこと。
  private async assertTargetMember(organizationId: string, targetUserId: string): Promise<void> {
    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: targetUserId } },
      select: { id: true },
    });
    if (!member) {
      throw new ForbiddenError('対象はこの会社のメンバーではありません');
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { isSuperAdmin: true },
    });
    if (target?.isSuperAdmin) {
      throw new ForbiddenError('全体管理者を対象にしたトークン発行はできません');
    }
  }

  @Post(':id/members/:userId/api-tokens')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'メンバー用APIトークン(会社スコープ)を発行（平文JWTは一度だけ返却）' })
  async issueMemberApiToken(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body() dto: IssueMemberApiTokenDto,
  ) {
    await this.assertCompanyAdmin(id, user);
    await this.assertTargetMember(id, targetUserId);
    return this.userApiTokenService.mint(targetUserId, dto.name, Date.now(), {
      scopeOrgId: id,
      issuedByUserId: user.id,
    });
  }

  @Get(':id/members/:userId/api-tokens')
  @ApiOperation({ summary: 'メンバーの会社スコープAPIトークン一覧（平文は含まない）' })
  async listMemberApiTokens(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ) {
    await this.assertCompanyAdmin(id, user);
    await this.assertTargetMember(id, targetUserId);
    const tokens = await this.userApiTokenService.listForOrgMember(targetUserId, id);
    // 監査表示用に発行者名を解決（issuedByUserId → users.name/email）。
    const issuerIds = [...new Set(tokens.map((t) => t.issuedByUserId).filter((v): v is string => !!v))];
    const issuers = issuerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: issuerIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const nameById = new Map(issuers.map((u) => [u.id, u.name || u.email]));
    return tokens.map((t) => ({
      ...t,
      issuedByName: t.issuedByUserId ? (nameById.get(t.issuedByUserId) ?? null) : null,
    }));
  }

  @Delete(':id/members/:userId/api-tokens/:tokenId')
  @ApiOperation({ summary: 'メンバーの会社スコープAPIトークンを失効' })
  async revokeMemberApiToken(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Param('tokenId') tokenId: string,
  ) {
    await this.assertCompanyAdmin(id, user);
    await this.assertTargetMember(id, targetUserId);
    await this.userApiTokenService.revokeForOrgMember(targetUserId, id, tokenId);
    return { success: true };
  }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd backend && npx jest src/presentation/controllers/organization.controller.spec.ts`
Expected: PASS（Task 5 の 3 + 本タスクの 5 = 8 tests）。

- [ ] **Step 5: モジュール配線を確認（UserApiTokenService が OrganizationController のモジュールで解決可能か）**

Run: `cd backend && npx tsc --noEmit`
Expected: 型エラー無し。もし DI 解決エラーが `nest build` 時に出る場合は、`OrganizationController` を宣言している module の `providers` に `UserApiTokenService` を追加する（`grep -rn "OrganizationController" backend/src --include=*.module.ts` で module を特定し、`UserApiTokenService` が `providers`/`exports` に無ければ追加）。

Run: `cd backend && npx nest build`
Expected: ビルド成功。

- [ ] **Step 6: Commit**

```bash
git add backend/src/presentation/controllers/organization.controller.ts backend/src/presentation/controllers/organization.controller.spec.ts backend/src/**/*.module.ts
git commit -m "feat(brainpro): 会社メンバー用トークンの発行/一覧/失効エンドポイントを追加"
```

---

### Task 7: フロントエンド メンバータブに発行/一覧/失効UI

**Files:**
- Modify: `frontend/src/app/(dashboard)/dashboard/companies/[orgId]/page.tsx`

**Interfaces:**
- Consumes: Task 6 の3エンドポイント（`POST/GET/DELETE /api/organizations/:id/members/:userId/api-tokens[/:tokenId]`）。既存 `getHeaders()`, `API_URL`, `members`, `myUserId`, `Member` 型, shadcn `Button`/`Input`/`Card` 群。
- Produces: 各メンバー行に「APIトークン発行」ボタン → 展開パネルで名前入力→発行→平文JWTを1回だけ表示（コピー）→ そのメンバーのこの会社スコープのトークン一覧（発行者・発行日時・失効ボタン）。

- [ ] **Step 1: 型・状態・ハンドラを追加**

`page.tsx` の `Member` 型定義の近くに、トークン行の型を追加:

```typescript
type MemberApiToken = {
  id: string;
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
  issuedByUserId: string | null;
  issuedByName: string | null;
};
```

コンポーネント関数内（`addingMember` state の近く）に状態を追加:

```typescript
  // メンバー別 会社スコープトークン（展開している memberUserId をキーに保持）。
  const [tokenPanelFor, setTokenPanelFor] = useState<string | null>(null);
  const [memberTokens, setMemberTokens] = useState<MemberApiToken[]>([]);
  const [newMemberTokenName, setNewMemberTokenName] = useState('');
  const [memberTokenBusy, setMemberTokenBusy] = useState(false);
  const [issuedMemberToken, setIssuedMemberToken] = useState<string | null>(null);
```

ハンドラ群を（`handleRemoveMember` の近くに）追加:

```typescript
  const openTokenPanel = useCallback(
    async (member: Member) => {
      setTokenPanelFor(member.userId);
      setIssuedMemberToken(null);
      setNewMemberTokenName('');
      setMemberTokens([]);
      try {
        const res = await fetch(
          `${API_URL}/api/organizations/${orgId}/members/${member.userId}/api-tokens`,
          { headers: getHeaders() },
        );
        if (res.ok) setMemberTokens(await res.json());
      } catch (err) {
        console.error('Failed to fetch member tokens:', err);
      }
    },
    [orgId, getHeaders],
  );

  const issueMemberToken = async (member: Member) => {
    const name = newMemberTokenName.trim();
    if (!name) return;
    setMemberTokenBusy(true);
    setMessage(null);
    setIssuedMemberToken(null);
    try {
      const res = await fetch(
        `${API_URL}/api/organizations/${orgId}/members/${member.userId}/api-tokens`,
        { method: 'POST', headers: getHeaders(), body: JSON.stringify({ name }) },
      );
      if (res.ok) {
        const data = await res.json();
        setIssuedMemberToken(data.token);
        setNewMemberTokenName('');
        await openTokenPanel(member);
        setIssuedMemberToken(data.token); // openTokenPanel が null 化するので再セット
        setMessage({
          type: 'success',
          text: `${member.name || member.email} 用のトークンを発行しました。今すぐコピーしてください（再表示できません）。`,
        });
      } else {
        const err = await res.json().catch(() => null);
        setMessage({ type: 'error', text: err?.message || 'トークンの発行に失敗しました' });
      }
    } catch {
      setMessage({ type: 'error', text: 'エラーが発生しました' });
    } finally {
      setMemberTokenBusy(false);
    }
  };

  const revokeMemberToken = async (member: Member, tokenId: string) => {
    if (!window.confirm('このトークンを失効しますか？このトークンを使う連携は無効になります。')) return;
    try {
      const res = await fetch(
        `${API_URL}/api/organizations/${orgId}/members/${member.userId}/api-tokens/${tokenId}`,
        { method: 'DELETE', headers: getHeaders() },
      );
      if (res.ok) {
        await openTokenPanel(member);
        setMessage({ type: 'success', text: 'トークンを失効しました' });
      } else {
        setMessage({ type: 'error', text: '失効に失敗しました' });
      }
    } catch {
      setMessage({ type: 'error', text: '失効に失敗しました' });
    }
  };
```

- [ ] **Step 2: メンバー行に発行ボタンと展開パネルを追加**

`page.tsx` のメンバー行（697-753行の `members.map`）で、行のアクション群（`handleResetPassword` ボタンの前）に「トークン」ボタンを追加:

```tsx
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              tokenPanelFor === m.userId
                                ? setTokenPanelFor(null)
                                : openTokenPanel(m)
                            }
                            title="このメンバー用のAPIトークン（会社スコープ）を発行/管理"
                          >
                            <KeyRound className="h-4 w-4 mr-1" />
                            トークン
                          </Button>
```

そして各メンバー行の `<div>` を、行本体と展開パネルを含むフラグメントに変える。`return (` の直後の行 `<div key={m.userId} className="flex flex-col gap-3 ...">` を次の構造に置き換える（行本体はそのまま、閉じ `</div>` の後に展開パネルを追加。`key` は外側 `<div>` に移す）:

```tsx
                    return (
                      <div key={m.userId}>
                        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                          {/* …既存の行本体（氏名/メール、ロールSelect、パスワード、削除、トークンボタン）… */}
                        </div>
                        {tokenPanelFor === m.userId && (
                          <div className="px-4 pb-4 space-y-3 bg-gray-50 border-t border-gray-100">
                            <p className="text-xs text-gray-500 pt-3">
                              このメンバーの権限で動く、この会社だけに効くAPIトークン（JWT）です。ipro など外部連携に貼り付けて使います。
                            </p>
                            <div className="flex gap-2">
                              <Input
                                value={newMemberTokenName}
                                onChange={(e) => setNewMemberTokenName(e.target.value)}
                                placeholder="用途（例: ipro連携）"
                                className="bg-white border-gray-300 text-gray-900 h-9"
                              />
                              <Button
                                size="sm"
                                onClick={() => issueMemberToken(m)}
                                disabled={!newMemberTokenName.trim() || memberTokenBusy}
                              >
                                {memberTokenBusy ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  '発行'
                                )}
                              </Button>
                            </div>
                            {issuedMemberToken && (
                              <div className="p-2 rounded bg-amber-50 border border-amber-200 space-y-1">
                                <p className="text-xs text-amber-800">
                                  このトークンは一度だけ表示されます。今すぐコピーしてください。
                                </p>
                                <div className="flex gap-2 items-center">
                                  <code className="flex-1 text-xs break-all bg-white p-1.5 rounded border border-amber-200">
                                    {issuedMemberToken}
                                  </code>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      navigator.clipboard.writeText(issuedMemberToken);
                                      setMessage({ type: 'success', text: 'トークンをコピーしました' });
                                    }}
                                  >
                                    コピー
                                  </Button>
                                </div>
                              </div>
                            )}
                            {memberTokens.length > 0 ? (
                              <div className="space-y-1">
                                {memberTokens.map((t) => (
                                  <div
                                    key={t.id}
                                    className="flex items-center justify-between text-xs bg-white border border-gray-200 rounded px-2 py-1.5"
                                  >
                                    <div className="min-w-0">
                                      <span className="font-medium text-gray-800">{t.name}</span>
                                      <span className="text-gray-400 ml-2">
                                        発行: {t.issuedByName ?? '—'} ・{' '}
                                        {new Date(t.createdAt).toLocaleDateString('ja-JP')}
                                      </span>
                                    </div>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="border-red-300 text-red-600 hover:bg-red-50 h-7"
                                      onClick={() => revokeMemberToken(m, t.id)}
                                    >
                                      失効
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-gray-400">発行済みトークンはありません</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
```

（注: 行本体の内部 JSX は既存のまま。外側 `<div key={m.userId}>` でラップし、既存の行 `<div className="flex flex-col …">` から `key` 属性を外すこと。`Loader2` は既に import 済み。）

- [ ] **Step 3: 型チェックとビルドで検証**

Run: `cd frontend && npx tsc --noEmit`
Expected: 型エラー無し。

Run: `cd frontend && npx next build`
Expected: ビルド成功（`Compiled successfully`）。

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/(dashboard)/dashboard/companies/[orgId]/page.tsx"
git commit -m "feat(brainpro-frontend): 会社メンバー行にメンバー用トークン(会社スコープ)の発行/一覧/失効UIを追加"
```

---

## Self-Review

**Spec coverage:**
- migration（scope_org_id / issued_by_user_id）→ Task 1 ✅
- UserApiTokenService（mint opts / resolve 拡張 / listForOrgMember / revokeForOrgMember）→ Task 2 ✅
- Guard（scopeOrgId を principal に）→ Task 3（request.user へ）＋ Task 4（guard build site が principal へ）✅
- resolveForPrincipal（越境deny）＋回帰テスト → Task 4 ✅
- assertCompanyAdmin（scope チェック＋呼び出し更新）→ Task 5 ✅
- OrganizationController 発行/一覧/失効（admin＋member＋super-admin ガード）→ Task 6 ✅
- frontend メンバータブ 発行/一覧/失効UI → Task 7 ✅
- 監査（issuedBy 表示）→ Task 6 の `issuedByName` 解決 ＋ Task 7 の表示 ✅
- self-service 不変 → Task 2 で `list`/`revoke` 温存＋既存 spec 緑を確認 ✅

**残余（spec 通り・本計画の非対象）:** `assertCompanyAdmin` を通さない別コントローラ独自の会社管理チェックは自動スコープ対象外。実データは Task 4 の resolveForPrincipal で完全スコープ、会社管理主経路は Task 5 で塞ぐため実運用リスクは低い。

**Type consistency:** `resolve()` の返り値 `{ userId, scopeOrgId }` は Task 2 で定義し Task 3 のガードが使用。`AccessPrincipal.scopeOrgId` / `CurrentUserPayload.scopeOrgId` は Task 3・4 で一貫。`mint(..., { scopeOrgId, issuedByUserId })` の opts 名は Task 2 定義＝Task 6 呼び出しと一致。`listForOrgMember` の select（`issuedByUserId` 含む）は Task 2＝Task 6 の enrich と一致。エンドポイントのパスは Task 6＝Task 7 で一致。
