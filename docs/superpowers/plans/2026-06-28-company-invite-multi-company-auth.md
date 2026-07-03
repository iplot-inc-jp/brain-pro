# 会社招待リンク ＋ Google/メアド認証 ＋ 複数会社切替 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 会社の共有招待リンクを発行し、被招待者が Google または メアドでサインインして会社に参加でき、1ユーザーが複数会社を切り替えられるようにする。

**Architecture:** 既存のカスタム JWT 認証（NestJS クリーンアーキ + フロント localStorage）を維持し、(1) Google ID トークンをバックエンドで検証して同一の JWT を発行する `POST /api/auth/google`、(2) `OrganizationInvite` テーブルと招待 use-case 群、(3) フロントの会社スイッチャー＋招待ページ＋Google ボタンを追加する。Google は env 未設定なら自動的に無効（メアド認証のみ）。

**Tech Stack:** NestJS + Prisma(PostgreSQL) + Jest（バックエンド） / Next.js 14 App Router + shadcn/Radix/Tailwind + `@react-oauth/google` + `google-auth-library`。

## Global Constraints

- **DI**: 依存は Symbol トークンで注入し、`backend/src/app.module.ts` の `providers`/`controllers` に登録する（個別モジュールは無い）。新しいクラスは必ず該当バレル `index.ts` に `export * from './x'` を追記する。
- **エラー変換**: use-case/リポジトリでは **ドメインエラー**を throw する。`DomainExceptionFilter` が変換: `ValidationError`→400, `EntityNotFoundError`→404, `UnauthorizedError`→401, `ForbiddenError`→403, `EntityAlreadyExistsError`→409。HTTP 固有（503 等）は controller で NestJS 例外を投げる。
- **バックエンドテスト**: spec は対象ソースと同じ場所（`src/...`）に `*.spec.ts` で置く。実行は `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest <keyword>`。`Date` を使う純粋関数テストでは `now` を引数で渡してモックする。
- **パスワード規約**: `User.password` は **NOT NULL の String** を維持し、`''`（空文字）= 「パスワード未設定（Google のみ / 招待中）」とする。既存のメアドログイン use-case は既に `if (!user.password)` で空を弾く（変更不要）。Google ユーザーは `''` で作成する。
- **フロント認証**: トークンは `localStorage` のキー **`accessToken`**。API は `frontend/src/lib/api.ts` の `api()` ラッパ経由（`auth:false` で無認証）。ベース URL は `process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021'`、エンドポイントは `/api` プレフィックス込み（`api()` が `/api` を付ける）。
- **環境変数（両方オプション）**: バックエンド `GOOGLE_CLIENT_ID`、フロント `NEXT_PUBLIC_GOOGLE_CLIENT_ID`。未設定時 = Google 無効（フロントはボタン非表示、バックエンドは 503）。
- **ブランド**: プロダクト名 `Brain Pro`、ネイビー定数 `NAVY = '#050f3e'`。
- **MemberRole**: Prisma 生成 enum（`'OWNER'|'ADMIN'|'MEMBER'|'VIEWER'` のユニオンとして TS で扱う。専用 TS enum は作らない）。

## File Structure

**バックエンド（新規）**
- `backend/src/domain/services/invite-validity.ts` — 招待の有効性を判定する純粋関数 + 型。
- `backend/src/domain/repositories/organization-invite.repository.ts` — `OrganizationInviteRecord` 型・`OrganizationInviteRepository` IF・`ORGANIZATION_INVITE_REPOSITORY` トークン。
- `backend/src/domain/services/google-verifier.service.ts` — `GoogleProfile` 型・`GoogleVerifierService` IF・`GOOGLE_VERIFIER_SERVICE` トークン。
- `backend/src/infrastructure/persistence/repositories/organization-invite.repository.impl.ts` — Prisma 実装。
- `backend/src/infrastructure/services/google-verifier.service.ts` — `google-auth-library` 実装。
- `backend/src/application/use-cases/invite/assert-org-admin.ts` — 管理者権限チェック共通関数。
- `backend/src/application/use-cases/invite/{accept,preview,create,list,revoke}-invite.use-case.ts` — 招待 use-case 群。
- `backend/src/application/use-cases/invite/index.ts` — invite バレル。
- `backend/src/application/use-cases/auth/login-with-google.use-case.ts` — Google ログイン use-case。
- `backend/src/presentation/controllers/invite.controller.ts` — 招待エンドポイント。
- `backend/src/presentation/dto/invite/{create-invite,google-login}.dto.ts` + `index.ts` — DTO。

**バックエンド（変更）**
- `backend/prisma/schema.prisma` — `OrganizationInvite` モデル追加・`User.googleId` 追加。
- `backend/src/domain/entities/user.entity.ts` — `googleId` 対応。
- `backend/src/infrastructure/persistence/repositories/user.repository.impl.ts` — `googleId` マッピング。
- `backend/src/presentation/controllers/auth.controller.ts` — `POST google` 追加。
- `backend/src/app.module.ts` — provider/controller 登録。
- 各バレル `index.ts`（repositories / services / use-cases / controllers / dto）。

**フロント（新規）**
- `frontend/src/components/auth/GoogleSignInButton.tsx` — env-gate な Google ボタン。
- `frontend/src/app/invite/[token]/page.tsx` — 招待受理ページ（公開）。
- `frontend/src/components/company/CompanySwitcher.tsx` — 会社スイッチャー。
- `frontend/src/components/company/InviteLinksPanel.tsx` — 会社設定の招待リンク管理 UI。

**フロント（変更）**
- `frontend/src/lib/api.ts` — `authApi.google` ＋ `invitesApi` ＋ `InviteView` 型。
- `frontend/src/app/(auth)/login/page.tsx` ・ `register/page.tsx` — Google ボタン挿入。
- `frontend/src/contexts/ProjectContext.tsx` — `selectedOrganizationId` 永続化・復元。
- `frontend/src/components/providers.tsx` — `ProjectProvider` マウント。
- `frontend/src/app/(dashboard)/layout.tsx` — サイドバーに `<CompanySwitcher />` 挿入。
- `frontend/src/app/(dashboard)/dashboard/companies/[orgId]/page.tsx` — メンバータブに `<InviteLinksPanel />` 挿入。

---

## Task 1: Prisma スキーマ（OrganizationInvite + User.googleId）

**Files:**
- Modify: `backend/prisma/schema.prisma`

**Interfaces:**
- Produces: テーブル `organization_invites`、`organizationInvite` Prisma クライアント、`users.google_id` カラム。

- [ ] **Step 1: `User` モデルに googleId を追加**

`model User` 内、`avatarUrl String? @map("avatar_url")` の次の行に追記:

```prisma
  googleId  String?  @unique @map("google_id")
```

- [ ] **Step 2: `Organization` モデルにリレーションを追加**

`model Organization` の `members  OrganizationMember[]` の下に追記:

```prisma
  invites  OrganizationInvite[]
```

- [ ] **Step 3: `User` モデルに作成者リレーションを追加**

`model User` の `projectMemberships  ProjectMember[]` の下に追記:

```prisma
  createdInvites      OrganizationInvite[] @relation("InviteCreatedBy")
```

- [ ] **Step 4: `OrganizationInvite` モデルを追加**

`enum MemberRole { ... }` の直前（または `OrganizationMember` モデルの直後）に追記:

```prisma
model OrganizationInvite {
  id              String     @id @default(uuid())
  organizationId  String     @map("organization_id")
  token           String     @unique
  role            MemberRole @default(MEMBER)
  createdByUserId String     @map("created_by_user_id")
  expiresAt       DateTime?  @map("expires_at")
  maxUses         Int?       @map("max_uses")
  useCount        Int        @default(0) @map("use_count")
  revokedAt       DateTime?  @map("revoked_at")
  createdAt       DateTime   @default(now()) @map("created_at")
  updatedAt       DateTime   @updatedAt @map("updated_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdBy    User         @relation("InviteCreatedBy", fields: [createdByUserId], references: [id])

  @@index([organizationId])
  @@map("organization_invites")
}
```

- [ ] **Step 5: マイグレーション生成 ＋ クライアント再生成**

Run:
```bash
cd /Users/kazuyukijimbo/ai-data-flow/backend && npx prisma migrate dev --name add_organization_invites_and_google_id && npx prisma generate
```
Expected: マイグレーションが作成・適用され、`Prisma Client` が再生成される（`organizationInvite` と `user.googleId` が型に出る）。

- [ ] **Step 6: コミット**

```bash
cd /Users/kazuyukijimbo/ai-data-flow && git add backend/prisma && git commit -m "feat(db): OrganizationInvite モデルと User.googleId を追加"
```

---

## Task 2: 招待有効性の純粋関数

**Files:**
- Create: `backend/src/domain/services/invite-validity.ts`
- Test: `backend/src/domain/services/invite-validity.spec.ts`
- Modify: `backend/src/domain/services/index.ts`

**Interfaces:**
- Produces:
  - `type InviteInvalidReason = 'notfound' | 'revoked' | 'expired' | 'maxed'`
  - `interface InviteValidity { valid: boolean; reason: InviteInvalidReason | null }`
  - `interface InviteValidityInput { revokedAt: Date | null; expiresAt: Date | null; maxUses: number | null; useCount: number } | null`
  - `function evaluateInviteValidity(invite: InviteValidityInput, now: Date): InviteValidity`

- [ ] **Step 1: 失敗するテストを書く**

Create `backend/src/domain/services/invite-validity.spec.ts`:

```typescript
import { evaluateInviteValidity } from './invite-validity';

const NOW = new Date('2026-06-28T00:00:00.000Z');
const base = { revokedAt: null as Date | null, expiresAt: null as Date | null, maxUses: null as number | null, useCount: 0 };

describe('evaluateInviteValidity', () => {
  it('null は notfound', () => {
    expect(evaluateInviteValidity(null, NOW)).toEqual({ valid: false, reason: 'notfound' });
  });
  it('未失効・無期限・無制限は valid', () => {
    expect(evaluateInviteValidity({ ...base }, NOW)).toEqual({ valid: true, reason: null });
  });
  it('revokedAt があれば revoked', () => {
    expect(evaluateInviteValidity({ ...base, revokedAt: NOW }, NOW)).toEqual({ valid: false, reason: 'revoked' });
  });
  it('expiresAt <= now は expired', () => {
    const past = new Date(NOW.getTime() - 1000);
    expect(evaluateInviteValidity({ ...base, expiresAt: past }, NOW)).toEqual({ valid: false, reason: 'expired' });
  });
  it('expiresAt が未来なら valid', () => {
    const future = new Date(NOW.getTime() + 1000);
    expect(evaluateInviteValidity({ ...base, expiresAt: future }, NOW).valid).toBe(true);
  });
  it('useCount >= maxUses は maxed', () => {
    expect(evaluateInviteValidity({ ...base, maxUses: 3, useCount: 3 }, NOW)).toEqual({ valid: false, reason: 'maxed' });
  });
  it('useCount < maxUses は valid', () => {
    expect(evaluateInviteValidity({ ...base, maxUses: 3, useCount: 2 }, NOW).valid).toBe(true);
  });
  it('revoked が expired より優先', () => {
    const past = new Date(NOW.getTime() - 1000);
    expect(evaluateInviteValidity({ ...base, revokedAt: NOW, expiresAt: past }, NOW).reason).toBe('revoked');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest invite-validity`
Expected: FAIL（`Cannot find module './invite-validity'`）。

- [ ] **Step 3: 実装を書く**

Create `backend/src/domain/services/invite-validity.ts`:

```typescript
/**
 * 招待リンクが無効になる理由。
 */
export type InviteInvalidReason = 'notfound' | 'revoked' | 'expired' | 'maxed';

export interface InviteValidity {
  valid: boolean;
  reason: InviteInvalidReason | null;
}

export interface InviteValidityFields {
  revokedAt: Date | null;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
}

/**
 * 招待の有効性を判定する純粋関数。
 * 優先順位: notfound > revoked > expired > maxed。
 */
export function evaluateInviteValidity(
  invite: InviteValidityFields | null,
  now: Date,
): InviteValidity {
  if (!invite) return { valid: false, reason: 'notfound' };
  if (invite.revokedAt) return { valid: false, reason: 'revoked' };
  if (invite.expiresAt && invite.expiresAt.getTime() <= now.getTime()) {
    return { valid: false, reason: 'expired' };
  }
  if (invite.maxUses != null && invite.useCount >= invite.maxUses) {
    return { valid: false, reason: 'maxed' };
  }
  return { valid: true, reason: null };
}
```

- [ ] **Step 4: バレルに追記**

`backend/src/domain/services/index.ts` の末尾に追記:

```typescript
export * from './invite-validity';
```

- [ ] **Step 5: テスト合格を確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest invite-validity`
Expected: PASS（8 件）。

- [ ] **Step 6: コミット**

```bash
cd /Users/kazuyukijimbo/ai-data-flow && git add backend/src/domain/services && git commit -m "feat(invite): 招待有効性の純粋関数 evaluateInviteValidity を追加"
```

---

## Task 3: OrganizationInvite リポジトリ（IF + Prisma 実装 + DI）

**Files:**
- Create: `backend/src/domain/repositories/organization-invite.repository.ts`
- Create: `backend/src/infrastructure/persistence/repositories/organization-invite.repository.impl.ts`
- Modify: `backend/src/domain/repositories/index.ts`, `backend/src/infrastructure/persistence/repositories/index.ts`, `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `evaluateInviteValidity`（Task 2）の `InviteValidityFields` 互換のフィールド。
- Produces:
  - `interface OrganizationInviteRecord { id; organizationId; token; role: 'OWNER'|'ADMIN'|'MEMBER'|'VIEWER'; createdByUserId; expiresAt: Date|null; maxUses: number|null; useCount: number; revokedAt: Date|null; createdAt: Date }`
  - `interface OrganizationInviteRepository { create(data): Promise<OrganizationInviteRecord>; findByToken(token): Promise<OrganizationInviteRecord|null>; findById(id): Promise<OrganizationInviteRecord|null>; findByOrganizationId(orgId): Promise<OrganizationInviteRecord[]>; incrementUseCount(id): Promise<void>; revoke(id): Promise<void>; generateId(): string; generateToken(): string }`
  - `const ORGANIZATION_INVITE_REPOSITORY: symbol`

- [ ] **Step 1: ドメイン IF を作成**

Create `backend/src/domain/repositories/organization-invite.repository.ts`:

```typescript
export type InviteRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

/**
 * 招待リンクの永続データ表現。
 */
export interface OrganizationInviteRecord {
  id: string;
  organizationId: string;
  token: string;
  role: InviteRole;
  createdByUserId: string;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface CreateInviteData {
  id: string;
  organizationId: string;
  token: string;
  role: InviteRole;
  createdByUserId: string;
  expiresAt: Date | null;
  maxUses: number | null;
}

/**
 * 招待リポジトリインターフェース。
 */
export interface OrganizationInviteRepository {
  create(data: CreateInviteData): Promise<OrganizationInviteRecord>;
  findByToken(token: string): Promise<OrganizationInviteRecord | null>;
  findById(id: string): Promise<OrganizationInviteRecord | null>;
  findByOrganizationId(organizationId: string): Promise<OrganizationInviteRecord[]>;
  incrementUseCount(id: string): Promise<void>;
  revoke(id: string): Promise<void>;
  generateId(): string;
  generateToken(): string;
}

export const ORGANIZATION_INVITE_REPOSITORY = Symbol('ORGANIZATION_INVITE_REPOSITORY');
```

- [ ] **Step 2: ドメインバレルに追記**

`backend/src/domain/repositories/index.ts` の末尾に追記:

```typescript
export * from './organization-invite.repository';
```

- [ ] **Step 3: Prisma 実装を作成**

Create `backend/src/infrastructure/persistence/repositories/organization-invite.repository.impl.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import {
  OrganizationInviteRepository,
  OrganizationInviteRecord,
  CreateInviteData,
  InviteRole,
} from '../../../domain';
import { PrismaService } from '../prisma/prisma.service';

type PrismaInviteRow = {
  id: string;
  organizationId: string;
  token: string;
  role: string;
  createdByUserId: string;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
  revokedAt: Date | null;
  createdAt: Date;
};

@Injectable()
export class OrganizationInviteRepositoryImpl implements OrganizationInviteRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: PrismaInviteRow): OrganizationInviteRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      token: row.token,
      role: row.role as InviteRole,
      createdByUserId: row.createdByUserId,
      expiresAt: row.expiresAt,
      maxUses: row.maxUses,
      useCount: row.useCount,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
    };
  }

  async create(data: CreateInviteData): Promise<OrganizationInviteRecord> {
    const row = await this.prisma.organizationInvite.create({
      data: {
        id: data.id,
        organizationId: data.organizationId,
        token: data.token,
        role: data.role,
        createdByUserId: data.createdByUserId,
        expiresAt: data.expiresAt,
        maxUses: data.maxUses,
      },
    });
    return this.toRecord(row);
  }

  async findByToken(token: string): Promise<OrganizationInviteRecord | null> {
    const row = await this.prisma.organizationInvite.findUnique({ where: { token } });
    return row ? this.toRecord(row) : null;
  }

  async findById(id: string): Promise<OrganizationInviteRecord | null> {
    const row = await this.prisma.organizationInvite.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async findByOrganizationId(organizationId: string): Promise<OrganizationInviteRecord[]> {
    const rows = await this.prisma.organizationInvite.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async incrementUseCount(id: string): Promise<void> {
    await this.prisma.organizationInvite.update({
      where: { id },
      data: { useCount: { increment: 1 } },
    });
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.organizationInvite.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  generateId(): string {
    return randomUUID();
  }

  generateToken(): string {
    return randomBytes(24).toString('base64url');
  }
}
```

- [ ] **Step 4: インフラバレルに追記**

`backend/src/infrastructure/persistence/repositories/index.ts` の末尾に追記:

```typescript
export * from './organization-invite.repository.impl';
```

- [ ] **Step 5: app.module.ts に provider 登録**

`backend/src/app.module.ts` の domain import に `ORGANIZATION_INVITE_REPOSITORY` を、infrastructure import に `OrganizationInviteRepositoryImpl` を追加し、`providers` 配列の Repository Implementations 群（`USER_REPOSITORY` の useClass の近く）に追記:

```typescript
    {
      provide: ORGANIZATION_INVITE_REPOSITORY,
      useClass: OrganizationInviteRepositoryImpl,
    },
```

- [ ] **Step 6: ビルド確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx tsc --noEmit -p tsconfig.json`
Expected: 型エラー無し（招待リポジトリが解決できる）。

- [ ] **Step 7: コミット**

```bash
cd /Users/kazuyukijimbo/ai-data-flow && git add backend/src && git commit -m "feat(invite): OrganizationInvite リポジトリ(IF+Prisma)とDI登録を追加"
```

---

## Task 4: User エンティティの googleId 対応

**Files:**
- Modify: `backend/src/domain/entities/user.entity.ts`, `backend/src/infrastructure/persistence/repositories/user.repository.impl.ts`
- Test: `backend/src/domain/entities/user.entity.spec.ts`

**Interfaces:**
- Produces:
  - `User.createWithGoogle(props: { email: string; name?: string | null; avatarUrl?: string | null; googleId: string }, id: string): User`（password は `''`）
  - `user.linkGoogle(googleId: string): void`
  - getter `user.googleId: string | null`
  - `ReconstructUserProps` に `googleId?: string | null` 追加。

- [ ] **Step 1: 失敗するテストを書く**

Create `backend/src/domain/entities/user.entity.spec.ts`:

```typescript
import { User } from './user.entity';

describe('User googleId', () => {
  it('createWithGoogle は password を空・googleId を設定する', () => {
    const u = User.createWithGoogle(
      { email: 'g@example.com', name: 'Google User', avatarUrl: 'http://x/y.png', googleId: 'gid-1' },
      'user-1',
    );
    expect(u.password).toBe('');
    expect(u.googleId).toBe('gid-1');
    expect(u.email).toBe('g@example.com');
    expect(u.name).toBe('Google User');
    expect(u.avatarUrl).toBe('http://x/y.png');
    expect(u.isSuperAdmin).toBe(false);
  });

  it('linkGoogle は googleId を後付けする', () => {
    const u = User.create({ email: 'a@example.com', password: 'x', name: null }, 'hashed', 'user-2');
    expect(u.googleId).toBeNull();
    u.linkGoogle('gid-2');
    expect(u.googleId).toBe('gid-2');
  });

  it('reconstruct は googleId を復元する', () => {
    const now = new Date();
    const u = User.reconstruct({
      id: 'user-3', email: 'b@example.com', password: 'h', name: null,
      avatarUrl: null, isSuperAdmin: false, googleId: 'gid-3', createdAt: now, updatedAt: now,
    });
    expect(u.googleId).toBe('gid-3');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest user.entity`
Expected: FAIL（`createWithGoogle`/`googleId` 未定義）。

- [ ] **Step 3: エンティティを変更**

`backend/src/domain/entities/user.entity.ts` を次のように変更:

(a) `ReconstructUserProps` に追加:
```typescript
  googleId?: string | null;
```

(b) フィールド宣言に追加（`private _isSuperAdmin: boolean;` の下）:
```typescript
  private _googleId: string | null;
```

(c) コンストラクタのシグネチャと super 呼び出しを変更（`isSuperAdmin` の後ろに `googleId` を差し込む）:
```typescript
  private constructor(
    id: string,
    email: Email,
    password: string,
    name: string | null,
    avatarUrl: string | null,
    isSuperAdmin: boolean,
    googleId: string | null,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id, createdAt, updatedAt);
    this._email = email;
    this._password = password;
    this._name = name;
    this._avatarUrl = avatarUrl;
    this._isSuperAdmin = isSuperAdmin;
    this._googleId = googleId;
  }
```

(d) `create()` の return を変更（`false` の後ろに `null`）:
```typescript
    return new User(id, email, hashedPassword, name, null, false, null, now, now);
```

(e) `reconstruct()` の return を変更:
```typescript
    return new User(
      props.id,
      Email.reconstruct(props.email),
      props.password,
      props.name,
      props.avatarUrl,
      props.isSuperAdmin ?? false,
      props.googleId ?? null,
      props.createdAt,
      props.updatedAt,
    );
```

(f) `reconstruct()` の直後に新しい静的メソッドを追加:
```typescript
  /**
   * Google アカウントからユーザーを新規作成（パスワード未設定）。
   */
  static createWithGoogle(
    props: { email: string; name?: string | null; avatarUrl?: string | null; googleId: string },
    id: string,
  ): User {
    const email = Email.create(props.email);
    const name = props.name?.trim() || null;
    if (name && name.length > 100) {
      throw new ValidationError('Name must be at most 100 characters');
    }
    const now = new Date();
    return new User(id, email, '', name, props.avatarUrl ?? null, false, props.googleId, now, now);
  }
```

(g) `promoteToSuperAdmin()` の近くにメソッドを追加:
```typescript
  /**
   * Google アカウントを既存ユーザーに紐付ける。
   */
  linkGoogle(googleId: string): void {
    this._googleId = googleId;
    this.touch();
  }
```

(h) getter 群に追加:
```typescript
  get googleId(): string | null {
    return this._googleId;
  }
```

- [ ] **Step 4: リポジトリ実装の googleId マッピングを追加**

`backend/src/infrastructure/persistence/repositories/user.repository.impl.ts`:

(a) `findById` と `findByEmail` の `User.reconstruct({ ... })` 両方に `googleId: data.googleId,` を追加（`isSuperAdmin: data.isSuperAdmin,` の後）。

(b) `save()` の `create:` と `update:` 両ブロックに `googleId: user.googleId,` を追加（`avatarUrl: user.avatarUrl,` の後）。

- [ ] **Step 5: テスト合格を確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest user.entity`
Expected: PASS（3 件）。

- [ ] **Step 6: ビルド確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx tsc --noEmit -p tsconfig.json`
Expected: 型エラー無し。

- [ ] **Step 7: コミット**

```bash
cd /Users/kazuyukijimbo/ai-data-flow && git add backend/src/domain backend/src/infrastructure && git commit -m "feat(auth): User エンティティに googleId と createWithGoogle/linkGoogle を追加"
```

---

## Task 5: Google ID トークン検証サービス

**Files:**
- Create: `backend/src/domain/services/google-verifier.service.ts`, `backend/src/infrastructure/services/google-verifier.service.ts`
- Modify: `backend/src/domain/services/index.ts`, `backend/src/infrastructure/services/index.ts`, `backend/src/app.module.ts`, `backend/package.json`(依存追加)

**Interfaces:**
- Produces:
  - `interface GoogleProfile { googleId: string; email: string; emailVerified: boolean; name: string | null; picture: string | null }`
  - `interface GoogleVerifierService { verifyIdToken(idToken: string): Promise<GoogleProfile | null> }`
  - `const GOOGLE_VERIFIER_SERVICE: symbol`
  - 実装 `GoogleAuthLibraryVerifierService`（`GOOGLE_CLIENT_ID` 未設定 or 検証失敗で `null`）。

- [ ] **Step 1: 依存を追加**

Run:
```bash
cd /Users/kazuyukijimbo/ai-data-flow/backend && pnpm add google-auth-library
```
Expected: `google-auth-library` が dependencies に入る。

- [ ] **Step 2: ドメイン IF を作成**

Create `backend/src/domain/services/google-verifier.service.ts`:

```typescript
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
```

- [ ] **Step 3: ドメインバレルに追記**

`backend/src/domain/services/index.ts` の末尾に追記:

```typescript
export * from './google-verifier.service';
```

- [ ] **Step 4: インフラ実装を作成**

Create `backend/src/infrastructure/services/google-verifier.service.ts`:

```typescript
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
```

- [ ] **Step 5: インフラバレルに追記**

`backend/src/infrastructure/services/index.ts` の末尾に追記:

```typescript
export * from './google-verifier.service';
```

- [ ] **Step 6: app.module.ts に provider 登録**

`backend/src/app.module.ts` で domain import に `GOOGLE_VERIFIER_SERVICE`、infrastructure import に `GoogleAuthLibraryVerifierService` を追加し、`providers` の Domain Service Implementations 群（`TOKEN_SERVICE` の近く）に追記:

```typescript
    {
      provide: GOOGLE_VERIFIER_SERVICE,
      useClass: GoogleAuthLibraryVerifierService,
    },
```

- [ ] **Step 7: ビルド確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx tsc --noEmit -p tsconfig.json`
Expected: 型エラー無し。

- [ ] **Step 8: コミット**

```bash
cd /Users/kazuyukijimbo/ai-data-flow && git add backend/src backend/package.json backend/pnpm-lock.yaml && git commit -m "feat(auth): Google ID トークン検証サービス(IF+google-auth-library実装)を追加"
```

---

## Task 6: AcceptInviteUseCase（招待受理・冪等）

**Files:**
- Create: `backend/src/application/use-cases/invite/accept-invite.use-case.ts`, `backend/src/application/use-cases/invite/index.ts`
- Test: `backend/src/application/use-cases/invite/accept-invite.use-case.spec.ts`
- Modify: `backend/src/application/use-cases/index.ts`

**Interfaces:**
- Consumes: `ORGANIZATION_INVITE_REPOSITORY`/`OrganizationInviteRepository`（Task 3）、`ORGANIZATION_REPOSITORY`/`OrganizationRepository`（既存 `getMemberRole`/`addMember`）、`evaluateInviteValidity`（Task 2）。
- Produces: `AcceptInviteUseCase.execute(input: { token: string; userId: string }): Promise<{ organizationId: string; alreadyMember: boolean }>`

- [ ] **Step 1: 失敗するテストを書く**

Create `backend/src/application/use-cases/invite/accept-invite.use-case.spec.ts`:

```typescript
import { AcceptInviteUseCase } from './accept-invite.use-case';
import { EntityNotFoundError, ValidationError } from '../../../domain';

function makeInvite(over: Partial<any> = {}) {
  return {
    id: 'inv-1', organizationId: 'org-1', token: 'tok', role: 'MEMBER',
    createdByUserId: 'admin-1', expiresAt: null, maxUses: null, useCount: 0,
    revokedAt: null, createdAt: new Date('2026-06-01'), ...over,
  };
}

describe('AcceptInviteUseCase', () => {
  let inviteRepo: any;
  let orgRepo: any;
  let useCase: AcceptInviteUseCase;

  beforeEach(() => {
    inviteRepo = {
      findByToken: jest.fn(),
      incrementUseCount: jest.fn().mockResolvedValue(undefined),
    };
    orgRepo = {
      getMemberRole: jest.fn(),
      addMember: jest.fn().mockResolvedValue(undefined),
    };
    useCase = new AcceptInviteUseCase(inviteRepo, orgRepo);
  });

  it('未所属なら addMember して useCount を増やす', async () => {
    inviteRepo.findByToken.mockResolvedValue(makeInvite());
    orgRepo.getMemberRole.mockResolvedValue(null);

    const res = await useCase.execute({ token: 'tok', userId: 'u-1' });

    expect(orgRepo.addMember).toHaveBeenCalledWith('org-1', { userId: 'u-1', role: 'MEMBER' });
    expect(inviteRepo.incrementUseCount).toHaveBeenCalledWith('inv-1');
    expect(res).toEqual({ organizationId: 'org-1', alreadyMember: false });
  });

  it('既に所属していれば冪等（追加も増加もしない）', async () => {
    inviteRepo.findByToken.mockResolvedValue(makeInvite());
    orgRepo.getMemberRole.mockResolvedValue('MEMBER');

    const res = await useCase.execute({ token: 'tok', userId: 'u-1' });

    expect(orgRepo.addMember).not.toHaveBeenCalled();
    expect(inviteRepo.incrementUseCount).not.toHaveBeenCalled();
    expect(res).toEqual({ organizationId: 'org-1', alreadyMember: true });
  });

  it('存在しないトークンは EntityNotFoundError', async () => {
    inviteRepo.findByToken.mockResolvedValue(null);
    await expect(useCase.execute({ token: 'x', userId: 'u-1' })).rejects.toBeInstanceOf(EntityNotFoundError);
  });

  it('revoke 済みは ValidationError', async () => {
    inviteRepo.findByToken.mockResolvedValue(makeInvite({ revokedAt: new Date('2026-06-02') }));
    await expect(useCase.execute({ token: 'tok', userId: 'u-1' })).rejects.toBeInstanceOf(ValidationError);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest accept-invite`
Expected: FAIL（モジュール未解決）。

- [ ] **Step 3: 実装を書く**

Create `backend/src/application/use-cases/invite/accept-invite.use-case.ts`:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import {
  OrganizationInviteRepository,
  ORGANIZATION_INVITE_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  evaluateInviteValidity,
  EntityNotFoundError,
  ValidationError,
} from '../../../domain';

export interface AcceptInviteInput {
  token: string;
  userId: string;
}

export interface AcceptInviteOutput {
  organizationId: string;
  alreadyMember: boolean;
}

/**
 * 招待リンクを受理して、現在のユーザーを会社に参加させる（冪等）。
 */
@Injectable()
export class AcceptInviteUseCase {
  constructor(
    @Inject(ORGANIZATION_INVITE_REPOSITORY)
    private readonly inviteRepository: OrganizationInviteRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: AcceptInviteInput): Promise<AcceptInviteOutput> {
    const invite = await this.inviteRepository.findByToken(input.token);
    const validity = evaluateInviteValidity(invite, new Date());

    if (!invite || validity.reason === 'notfound') {
      throw new EntityNotFoundError('Invite', input.token);
    }
    if (!validity.valid) {
      const messages: Record<string, string> = {
        revoked: 'この招待リンクは無効化されています',
        expired: 'この招待リンクは有効期限が切れています',
        maxed: 'この招待リンクは利用上限に達しています',
      };
      throw new ValidationError(messages[validity.reason ?? 'expired'] ?? '無効な招待リンクです');
    }

    const existingRole = await this.organizationRepository.getMemberRole(
      invite.organizationId,
      input.userId,
    );
    if (existingRole) {
      return { organizationId: invite.organizationId, alreadyMember: true };
    }

    await this.organizationRepository.addMember(invite.organizationId, {
      userId: input.userId,
      role: invite.role,
    });
    await this.inviteRepository.incrementUseCount(invite.id);

    return { organizationId: invite.organizationId, alreadyMember: false };
  }
}
```

- [ ] **Step 4: invite バレルを作成**

Create `backend/src/application/use-cases/invite/index.ts`:

```typescript
export * from './accept-invite.use-case';
```

- [ ] **Step 5: use-cases バレルに追記**

`backend/src/application/use-cases/index.ts` の末尾に追記:

```typescript
export * from './invite';
```

- [ ] **Step 6: テスト合格を確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest accept-invite`
Expected: PASS（4 件）。

- [ ] **Step 7: コミット**

```bash
cd /Users/kazuyukijimbo/ai-data-flow && git add backend/src/application && git commit -m "feat(invite): AcceptInviteUseCase(冪等な会社参加)を追加"
```

---

## Task 7: 招待管理 use-case（admin チェック + create/list/revoke）

**Files:**
- Create: `backend/src/application/use-cases/invite/assert-org-admin.ts`, `.../normalize-member-role.ts`, `.../invite-view.ts`, `.../create-invite.use-case.ts`, `.../list-invites.use-case.ts`, `.../revoke-invite.use-case.ts`
- Test: `.../create-invite.use-case.spec.ts`, `.../revoke-invite.use-case.spec.ts`
- Modify: `backend/src/application/use-cases/invite/index.ts`

**Interfaces:**
- Consumes: `USER_REPOSITORY`/`UserRepository`（`findById` → `isSuperAdmin`）、`ORGANIZATION_REPOSITORY`（`getMemberRole`）、`ORGANIZATION_INVITE_REPOSITORY`。
- Produces:
  - `assertOrgAdmin(userRepo, orgRepo, organizationId, userId): Promise<void>`（権限が無ければ `ForbiddenError`）
  - `normalizeMemberRole(role?: string): 'OWNER'|'ADMIN'|'MEMBER'|'VIEWER'`
  - `interface InviteView { id; token; role; expiresAt: string|null; maxUses: number|null; useCount: number; revoked: boolean; valid: boolean }` ＋ `toInviteView(record, now): InviteView`
  - `CreateInviteUseCase.execute({ organizationId; requesterUserId; role?; expiresInDays?; maxUses? }): Promise<InviteView>`
  - `ListInvitesUseCase.execute({ organizationId; requesterUserId }): Promise<InviteView[]>`
  - `RevokeInviteUseCase.execute({ organizationId; requesterUserId; inviteId }): Promise<void>`

- [ ] **Step 1: admin チェック関数を作成**

Create `backend/src/application/use-cases/invite/assert-org-admin.ts`:

```typescript
import {
  UserRepository,
  OrganizationRepository,
  ForbiddenError,
} from '../../../domain';

/**
 * 会社の管理者（superAdmin / OWNER / ADMIN）であることを保証する。
 */
export async function assertOrgAdmin(
  userRepository: UserRepository,
  organizationRepository: OrganizationRepository,
  organizationId: string,
  userId: string,
): Promise<void> {
  const user = await userRepository.findById(userId);
  if (user?.isSuperAdmin) return;

  const role = await organizationRepository.getMemberRole(organizationId, userId);
  if (role === 'OWNER' || role === 'ADMIN') return;

  throw new ForbiddenError('この会社を管理する権限がありません');
}
```

- [ ] **Step 2: ロール正規化と InviteView を作成**

Create `backend/src/application/use-cases/invite/normalize-member-role.ts`:

```typescript
export type NormalizedRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

/**
 * 入力文字列を MemberRole に正規化する。既定は MEMBER。
 */
export function normalizeMemberRole(role?: string): NormalizedRole {
  const r = (role ?? '').trim();
  if (r === '会社管理者') return 'OWNER';
  if (r === '一般ユーザー') return 'MEMBER';
  if (r === 'OWNER' || r === 'ADMIN' || r === 'MEMBER' || r === 'VIEWER') return r;
  return 'MEMBER';
}
```

Create `backend/src/application/use-cases/invite/invite-view.ts`:

```typescript
import { OrganizationInviteRecord, evaluateInviteValidity } from '../../../domain';

export interface InviteView {
  id: string;
  token: string;
  role: string;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  revoked: boolean;
  valid: boolean;
}

/**
 * 招待レコードを API レスポンス用の View に変換する。
 */
export function toInviteView(record: OrganizationInviteRecord, now: Date): InviteView {
  return {
    id: record.id,
    token: record.token,
    role: record.role,
    expiresAt: record.expiresAt ? record.expiresAt.toISOString() : null,
    maxUses: record.maxUses,
    useCount: record.useCount,
    revoked: Boolean(record.revokedAt),
    valid: evaluateInviteValidity(record, now).valid,
  };
}
```

- [ ] **Step 3: 失敗するテストを書く（create + revoke）**

Create `backend/src/application/use-cases/invite/create-invite.use-case.spec.ts`:

```typescript
import { CreateInviteUseCase } from './create-invite.use-case';
import { ForbiddenError } from '../../../domain';

describe('CreateInviteUseCase', () => {
  let userRepo: any, orgRepo: any, inviteRepo: any, useCase: CreateInviteUseCase;

  beforeEach(() => {
    userRepo = { findById: jest.fn() };
    orgRepo = { getMemberRole: jest.fn() };
    inviteRepo = {
      generateId: jest.fn().mockReturnValue('inv-1'),
      generateToken: jest.fn().mockReturnValue('tok-1'),
      create: jest.fn().mockImplementation(async (d) => ({
        ...d, useCount: 0, revokedAt: null, createdAt: new Date('2026-06-28'),
      })),
    };
    useCase = new CreateInviteUseCase(userRepo, orgRepo, inviteRepo);
  });

  it('ADMIN は作成でき、role 既定は MEMBER', async () => {
    userRepo.findById.mockResolvedValue({ isSuperAdmin: false });
    orgRepo.getMemberRole.mockResolvedValue('ADMIN');

    const view = await useCase.execute({ organizationId: 'org-1', requesterUserId: 'u-1' });

    expect(inviteRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', token: 'tok-1', role: 'MEMBER', maxUses: null, expiresAt: null }),
    );
    expect(view.token).toBe('tok-1');
    expect(view.valid).toBe(true);
  });

  it('expiresInDays から expiresAt を計算する', async () => {
    userRepo.findById.mockResolvedValue({ isSuperAdmin: true });
    orgRepo.getMemberRole.mockResolvedValue(null);

    await useCase.execute({ organizationId: 'org-1', requesterUserId: 'u-1', expiresInDays: 7, maxUses: 5, role: 'VIEWER' });

    const arg = inviteRepo.create.mock.calls[0][0];
    expect(arg.role).toBe('VIEWER');
    expect(arg.maxUses).toBe(5);
    expect(arg.expiresAt).toBeInstanceOf(Date);
  });

  it('権限が無ければ ForbiddenError', async () => {
    userRepo.findById.mockResolvedValue({ isSuperAdmin: false });
    orgRepo.getMemberRole.mockResolvedValue('MEMBER');
    await expect(useCase.execute({ organizationId: 'org-1', requesterUserId: 'u-1' })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
```

Create `backend/src/application/use-cases/invite/revoke-invite.use-case.spec.ts`:

```typescript
import { RevokeInviteUseCase } from './revoke-invite.use-case';
import { EntityNotFoundError, ForbiddenError } from '../../../domain';

describe('RevokeInviteUseCase', () => {
  let userRepo: any, orgRepo: any, inviteRepo: any, useCase: RevokeInviteUseCase;

  beforeEach(() => {
    userRepo = { findById: jest.fn().mockResolvedValue({ isSuperAdmin: true }) };
    orgRepo = { getMemberRole: jest.fn() };
    inviteRepo = { findById: jest.fn(), revoke: jest.fn().mockResolvedValue(undefined) };
    useCase = new RevokeInviteUseCase(userRepo, orgRepo, inviteRepo);
  });

  it('対象会社の招待なら revoke する', async () => {
    inviteRepo.findById.mockResolvedValue({ id: 'inv-1', organizationId: 'org-1' });
    await useCase.execute({ organizationId: 'org-1', requesterUserId: 'u-1', inviteId: 'inv-1' });
    expect(inviteRepo.revoke).toHaveBeenCalledWith('inv-1');
  });

  it('存在しなければ EntityNotFoundError', async () => {
    inviteRepo.findById.mockResolvedValue(null);
    await expect(useCase.execute({ organizationId: 'org-1', requesterUserId: 'u-1', inviteId: 'x' })).rejects.toBeInstanceOf(EntityNotFoundError);
  });

  it('別会社の招待は EntityNotFoundError（漏洩防止）', async () => {
    inviteRepo.findById.mockResolvedValue({ id: 'inv-9', organizationId: 'org-OTHER' });
    await expect(useCase.execute({ organizationId: 'org-1', requesterUserId: 'u-1', inviteId: 'inv-9' })).rejects.toBeInstanceOf(EntityNotFoundError);
  });

  it('権限が無ければ ForbiddenError', async () => {
    userRepo.findById.mockResolvedValue({ isSuperAdmin: false });
    orgRepo.getMemberRole.mockResolvedValue('VIEWER');
    await expect(useCase.execute({ organizationId: 'org-1', requesterUserId: 'u-1', inviteId: 'inv-1' })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
```

- [ ] **Step 4: テストが失敗することを確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest "create-invite|revoke-invite"`
Expected: FAIL（モジュール未解決）。

- [ ] **Step 5: use-case を実装**

Create `backend/src/application/use-cases/invite/create-invite.use-case.ts`:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import {
  UserRepository, USER_REPOSITORY,
  OrganizationRepository, ORGANIZATION_REPOSITORY,
  OrganizationInviteRepository, ORGANIZATION_INVITE_REPOSITORY,
} from '../../../domain';
import { assertOrgAdmin } from './assert-org-admin';
import { normalizeMemberRole } from './normalize-member-role';
import { InviteView, toInviteView } from './invite-view';

export interface CreateInviteInput {
  organizationId: string;
  requesterUserId: string;
  role?: string;
  expiresInDays?: number;
  maxUses?: number;
}

@Injectable()
export class CreateInviteUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizationRepository: OrganizationRepository,
    @Inject(ORGANIZATION_INVITE_REPOSITORY) private readonly inviteRepository: OrganizationInviteRepository,
  ) {}

  async execute(input: CreateInviteInput): Promise<InviteView> {
    await assertOrgAdmin(this.userRepository, this.organizationRepository, input.organizationId, input.requesterUserId);

    const now = new Date();
    const expiresAt =
      input.expiresInDays && input.expiresInDays > 0
        ? new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

    const record = await this.inviteRepository.create({
      id: this.inviteRepository.generateId(),
      organizationId: input.organizationId,
      token: this.inviteRepository.generateToken(),
      role: normalizeMemberRole(input.role),
      createdByUserId: input.requesterUserId,
      expiresAt,
      maxUses: input.maxUses ?? null,
    });

    return toInviteView(record, now);
  }
}
```

Create `backend/src/application/use-cases/invite/list-invites.use-case.ts`:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import {
  UserRepository, USER_REPOSITORY,
  OrganizationRepository, ORGANIZATION_REPOSITORY,
  OrganizationInviteRepository, ORGANIZATION_INVITE_REPOSITORY,
} from '../../../domain';
import { assertOrgAdmin } from './assert-org-admin';
import { InviteView, toInviteView } from './invite-view';

export interface ListInvitesInput {
  organizationId: string;
  requesterUserId: string;
}

@Injectable()
export class ListInvitesUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizationRepository: OrganizationRepository,
    @Inject(ORGANIZATION_INVITE_REPOSITORY) private readonly inviteRepository: OrganizationInviteRepository,
  ) {}

  async execute(input: ListInvitesInput): Promise<InviteView[]> {
    await assertOrgAdmin(this.userRepository, this.organizationRepository, input.organizationId, input.requesterUserId);
    const now = new Date();
    const records = await this.inviteRepository.findByOrganizationId(input.organizationId);
    return records.map((r) => toInviteView(r, now));
  }
}
```

Create `backend/src/application/use-cases/invite/revoke-invite.use-case.ts`:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import {
  UserRepository, USER_REPOSITORY,
  OrganizationRepository, ORGANIZATION_REPOSITORY,
  OrganizationInviteRepository, ORGANIZATION_INVITE_REPOSITORY,
  EntityNotFoundError,
} from '../../../domain';
import { assertOrgAdmin } from './assert-org-admin';

export interface RevokeInviteInput {
  organizationId: string;
  requesterUserId: string;
  inviteId: string;
}

@Injectable()
export class RevokeInviteUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizationRepository: OrganizationRepository,
    @Inject(ORGANIZATION_INVITE_REPOSITORY) private readonly inviteRepository: OrganizationInviteRepository,
  ) {}

  async execute(input: RevokeInviteInput): Promise<void> {
    await assertOrgAdmin(this.userRepository, this.organizationRepository, input.organizationId, input.requesterUserId);

    const invite = await this.inviteRepository.findById(input.inviteId);
    if (!invite || invite.organizationId !== input.organizationId) {
      throw new EntityNotFoundError('Invite', input.inviteId);
    }
    await this.inviteRepository.revoke(invite.id);
  }
}
```

- [ ] **Step 6: invite バレルに追記**

`backend/src/application/use-cases/invite/index.ts` を次の内容に置き換え:

```typescript
export * from './accept-invite.use-case';
export * from './create-invite.use-case';
export * from './list-invites.use-case';
export * from './revoke-invite.use-case';
export * from './invite-view';
```

- [ ] **Step 7: テスト合格を確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest "create-invite|revoke-invite"`
Expected: PASS（7 件）。

- [ ] **Step 8: コミット**

```bash
cd /Users/kazuyukijimbo/ai-data-flow && git add backend/src/application && git commit -m "feat(invite): 招待の作成/一覧/無効化 use-case と admin チェックを追加"
```

---

## Task 8: PreviewInviteUseCase（公開プレビュー）

**Files:**
- Create: `backend/src/application/use-cases/invite/preview-invite.use-case.ts`
- Test: `backend/src/application/use-cases/invite/preview-invite.use-case.spec.ts`
- Modify: `backend/src/application/use-cases/invite/index.ts`

**Interfaces:**
- Consumes: `ORGANIZATION_INVITE_REPOSITORY`, `ORGANIZATION_REPOSITORY`（`findById` → org 名）, `evaluateInviteValidity`。
- Produces: `PreviewInviteUseCase.execute({ token }): Promise<{ valid: boolean; reason: string | null; organizationName: string | null; role: string | null }>`

- [ ] **Step 1: 失敗するテストを書く**

Create `backend/src/application/use-cases/invite/preview-invite.use-case.spec.ts`:

```typescript
import { PreviewInviteUseCase } from './preview-invite.use-case';

describe('PreviewInviteUseCase', () => {
  let inviteRepo: any, orgRepo: any, useCase: PreviewInviteUseCase;

  beforeEach(() => {
    inviteRepo = { findByToken: jest.fn() };
    orgRepo = { findById: jest.fn() };
    useCase = new PreviewInviteUseCase(inviteRepo, orgRepo);
  });

  it('有効な招待は会社名とロールを返す', async () => {
    inviteRepo.findByToken.mockResolvedValue({
      id: 'inv-1', organizationId: 'org-1', token: 't', role: 'MEMBER',
      createdByUserId: 'a', expiresAt: null, maxUses: null, useCount: 0, revokedAt: null, createdAt: new Date(),
    });
    orgRepo.findById.mockResolvedValue({ name: 'ACME' });

    const res = await useCase.execute({ token: 't' });
    expect(res).toEqual({ valid: true, reason: null, organizationName: 'ACME', role: 'MEMBER' });
  });

  it('存在しないトークンは notfound・機微情報なし', async () => {
    inviteRepo.findByToken.mockResolvedValue(null);
    const res = await useCase.execute({ token: 'x' });
    expect(res).toEqual({ valid: false, reason: 'notfound', organizationName: null, role: null });
    expect(orgRepo.findById).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest preview-invite`
Expected: FAIL。

- [ ] **Step 3: 実装を書く**

Create `backend/src/application/use-cases/invite/preview-invite.use-case.ts`:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import {
  OrganizationInviteRepository, ORGANIZATION_INVITE_REPOSITORY,
  OrganizationRepository, ORGANIZATION_REPOSITORY,
  evaluateInviteValidity,
} from '../../../domain';

export interface PreviewInviteInput {
  token: string;
}

export interface PreviewInviteOutput {
  valid: boolean;
  reason: string | null;
  organizationName: string | null;
  role: string | null;
}

/**
 * 招待リンクのプレビュー（公開・機微情報を返さない）。
 */
@Injectable()
export class PreviewInviteUseCase {
  constructor(
    @Inject(ORGANIZATION_INVITE_REPOSITORY) private readonly inviteRepository: OrganizationInviteRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: PreviewInviteInput): Promise<PreviewInviteOutput> {
    const invite = await this.inviteRepository.findByToken(input.token);
    const validity = evaluateInviteValidity(invite, new Date());

    if (!invite) {
      return { valid: false, reason: 'notfound', organizationName: null, role: null };
    }

    const org = await this.organizationRepository.findById(invite.organizationId);
    return {
      valid: validity.valid,
      reason: validity.reason,
      organizationName: org?.name ?? null,
      role: invite.role,
    };
  }
}
```

- [ ] **Step 4: バレルに追記**

`backend/src/application/use-cases/invite/index.ts` の末尾に追記:

```typescript
export * from './preview-invite.use-case';
```

- [ ] **Step 5: テスト合格を確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest preview-invite`
Expected: PASS（2 件）。

- [ ] **Step 6: コミット**

```bash
cd /Users/kazuyukijimbo/ai-data-flow && git add backend/src/application && git commit -m "feat(invite): PreviewInviteUseCase(公開プレビュー)を追加"
```

---

## Task 9: LoginWithGoogleUseCase

**Files:**
- Create: `backend/src/application/use-cases/auth/login-with-google.use-case.ts`
- Test: `backend/src/application/use-cases/auth/login-with-google.use-case.spec.ts`
- Modify: `backend/src/application/use-cases/auth/index.ts`

**Interfaces:**
- Consumes: `GOOGLE_VERIFIER_SERVICE`/`GoogleVerifierService`（Task 5）、`USER_REPOSITORY`、`TOKEN_SERVICE`、`AcceptInviteUseCase`（Task 6, optional な inviteToken のとき呼ぶ）。
- Produces: `LoginWithGoogleUseCase.execute({ idToken: string; inviteToken?: string }): Promise<{ accessToken: string; user: { id; email; name: string|null; isSuperAdmin: boolean; avatarUrl: string|null }; joinedOrganizationId: string | null }>`

- [ ] **Step 1: 失敗するテストを書く**

Create `backend/src/application/use-cases/auth/login-with-google.use-case.spec.ts`:

```typescript
import { LoginWithGoogleUseCase } from './login-with-google.use-case';
import { User, UnauthorizedError } from '../../../domain';

describe('LoginWithGoogleUseCase', () => {
  let verifier: any, userRepo: any, tokenService: any, acceptInvite: any, useCase: LoginWithGoogleUseCase;

  beforeEach(() => {
    verifier = { verifyIdToken: jest.fn() };
    userRepo = {
      findByEmail: jest.fn(),
      generateId: jest.fn().mockReturnValue('new-id'),
      save: jest.fn().mockResolvedValue(undefined),
    };
    tokenService = { generateAccessToken: jest.fn().mockReturnValue('jwt-xyz') };
    acceptInvite = { execute: jest.fn() };
    useCase = new LoginWithGoogleUseCase(verifier, userRepo, tokenService, acceptInvite);
  });

  it('未確認メールは UnauthorizedError', async () => {
    verifier.verifyIdToken.mockResolvedValue({ googleId: 'g', email: 'e@x.com', emailVerified: false, name: null, picture: null });
    await expect(useCase.execute({ idToken: 't' })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('検証失敗(null)は UnauthorizedError', async () => {
    verifier.verifyIdToken.mockResolvedValue(null);
    await expect(useCase.execute({ idToken: 't' })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('新規メールはユーザー作成して JWT を返す', async () => {
    verifier.verifyIdToken.mockResolvedValue({ googleId: 'g1', email: 'new@x.com', emailVerified: true, name: 'New', picture: 'http://p' });
    userRepo.findByEmail.mockResolvedValue(null);

    const res = await useCase.execute({ idToken: 't' });

    expect(userRepo.save).toHaveBeenCalled();
    expect(res.accessToken).toBe('jwt-xyz');
    expect(res.user.email).toBe('new@x.com');
    expect(res.joinedOrganizationId).toBeNull();
  });

  it('既存メールで googleId 未設定なら紐付ける', async () => {
    const existing = User.create({ email: 'old@x.com', password: 'p', name: 'Old' }, 'hashed', 'old-id');
    verifier.verifyIdToken.mockResolvedValue({ googleId: 'g2', email: 'old@x.com', emailVerified: true, name: 'Old', picture: null });
    userRepo.findByEmail.mockResolvedValue(existing);

    const res = await useCase.execute({ idToken: 't' });

    expect(existing.googleId).toBe('g2');
    expect(res.user.id).toBe('old-id');
  });

  it('inviteToken があれば AcceptInvite を呼び joinedOrganizationId を返す', async () => {
    verifier.verifyIdToken.mockResolvedValue({ googleId: 'g3', email: 'a@x.com', emailVerified: true, name: null, picture: null });
    userRepo.findByEmail.mockResolvedValue(null);
    acceptInvite.execute.mockResolvedValue({ organizationId: 'org-9', alreadyMember: false });

    const res = await useCase.execute({ idToken: 't', inviteToken: 'inv' });

    expect(acceptInvite.execute).toHaveBeenCalledWith({ token: 'inv', userId: 'new-id' });
    expect(res.joinedOrganizationId).toBe('org-9');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest login-with-google`
Expected: FAIL。

- [ ] **Step 3: 実装を書く**

Create `backend/src/application/use-cases/auth/login-with-google.use-case.ts`:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import {
  User,
  UserRepository, USER_REPOSITORY,
  TokenService, TOKEN_SERVICE,
  GoogleVerifierService, GOOGLE_VERIFIER_SERVICE,
  UnauthorizedError,
} from '../../../domain';
import { AcceptInviteUseCase } from '../invite/accept-invite.use-case';

export interface LoginWithGoogleInput {
  idToken: string;
  inviteToken?: string;
}

export interface LoginWithGoogleOutput {
  accessToken: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    isSuperAdmin: boolean;
    avatarUrl: string | null;
  };
  joinedOrganizationId: string | null;
}

/**
 * SUPER_ADMIN_EMAILS に含まれるか判定。
 */
function isBootstrapSuperAdminEmail(email: string): boolean {
  const list = (process.env.SUPER_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  return list.includes(email.trim().toLowerCase());
}

/**
 * Google ID トークンでログイン/サインアップし、既存と同じ JWT を発行する。
 * inviteToken があればそのまま会社に参加させる。
 */
@Injectable()
export class LoginWithGoogleUseCase {
  constructor(
    @Inject(GOOGLE_VERIFIER_SERVICE) private readonly googleVerifier: GoogleVerifierService,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(TOKEN_SERVICE) private readonly tokenService: TokenService,
    private readonly acceptInviteUseCase: AcceptInviteUseCase,
  ) {}

  async execute(input: LoginWithGoogleInput): Promise<LoginWithGoogleOutput> {
    const profile = await this.googleVerifier.verifyIdToken(input.idToken);
    if (!profile) {
      throw new UnauthorizedError('Google認証に失敗しました');
    }
    if (!profile.emailVerified) {
      throw new UnauthorizedError('Googleアカウントのメールが未確認です');
    }

    let user = await this.userRepository.findByEmail(profile.email);
    if (!user) {
      user = User.createWithGoogle(
        {
          email: profile.email,
          name: profile.name,
          avatarUrl: profile.picture,
          googleId: profile.googleId,
        },
        this.userRepository.generateId(),
      );
    } else if (!user.googleId) {
      user.linkGoogle(profile.googleId);
      if (!user.avatarUrl && profile.picture) user.changeAvatarUrl(profile.picture);
      if (!user.name && profile.name) user.changeName(profile.name);
    }

    if (!user.isSuperAdmin && isBootstrapSuperAdminEmail(user.email)) {
      user.promoteToSuperAdmin();
    }

    await this.userRepository.save(user);

    let joinedOrganizationId: string | null = null;
    if (input.inviteToken) {
      const result = await this.acceptInviteUseCase.execute({
        token: input.inviteToken,
        userId: user.id,
      });
      joinedOrganizationId = result.organizationId;
    }

    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      email: user.email,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isSuperAdmin: user.isSuperAdmin,
        avatarUrl: user.avatarUrl,
      },
      joinedOrganizationId,
    };
  }
}
```

- [ ] **Step 4: auth バレルに追記**

`backend/src/application/use-cases/auth/index.ts` の末尾に追記:

```typescript
export * from './login-with-google.use-case';
```

- [ ] **Step 5: テスト合格を確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest login-with-google`
Expected: PASS（5 件）。

- [ ] **Step 6: コミット**

```bash
cd /Users/kazuyukijimbo/ai-data-flow && git add backend/src/application && git commit -m "feat(auth): LoginWithGoogleUseCase(Google検証→JWT発行→任意で招待受理)を追加"
```

---

## Task 10: DTO + InviteController + Google エンドポイント + DI 登録

**Files:**
- Create: `backend/src/presentation/dto/invite/create-invite.dto.ts`, `.../google-login.dto.ts`, `.../index.ts`
- Create: `backend/src/presentation/controllers/invite.controller.ts`
- Modify: `backend/src/presentation/controllers/auth.controller.ts`, `backend/src/presentation/dto/index.ts`, `backend/src/presentation/controllers/index.ts`, `backend/src/app.module.ts`

**Interfaces:**
- Consumes: 全 invite use-case（Task 6-8）、`LoginWithGoogleUseCase`（Task 9）、`@Public()`、`@CurrentUser()`。
- Produces:
  - HTTP `GET /api/invites/:token`（公開）, `POST /api/invites/:token/accept`（認証）, `GET /api/organizations/:id/invites`, `POST /api/organizations/:id/invites`, `DELETE /api/organizations/:id/invites/:inviteId`, `POST /api/auth/google`（公開）。

- [ ] **Step 1: DTO を作成**

Create `backend/src/presentation/dto/invite/google-login.dto.ts`:

```typescript
import { IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GoogleLoginRequestDto {
  @ApiProperty({ description: 'Google ID トークン(credential)' })
  @IsString()
  idToken: string;

  @ApiPropertyOptional({ description: '同時に受理する招待トークン' })
  @IsOptional()
  @IsString()
  inviteToken?: string;
}
```

Create `backend/src/presentation/dto/invite/create-invite.dto.ts`:

```typescript
import { IsInt, IsOptional, IsString, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInviteRequestDto {
  @ApiPropertyOptional({ description: 'ロール(OWNER/ADMIN/MEMBER/VIEWER)。既定 MEMBER' })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({ description: '有効日数。未指定なら無期限' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;

  @ApiPropertyOptional({ description: '最大利用回数。未指定なら無制限' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;
}
```

Create `backend/src/presentation/dto/invite/index.ts`:

```typescript
export * from './google-login.dto';
export * from './create-invite.dto';
```

- [ ] **Step 2: dto バレルに追記**

`backend/src/presentation/dto/index.ts` の末尾に追記:

```typescript
export * from './invite';
```

- [ ] **Step 3: InviteController を作成**

Create `backend/src/presentation/controllers/invite.controller.ts`:

```typescript
import { Controller, Get, Post, Delete, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  PreviewInviteUseCase,
  AcceptInviteUseCase,
  CreateInviteUseCase,
  ListInvitesUseCase,
  RevokeInviteUseCase,
} from '../../application';
import { CreateInviteRequestDto } from '../dto';
import { Public } from '../decorators/public.decorator';
import { CurrentUser, CurrentUserPayload } from '../decorators/current-user.decorator';

@ApiTags('招待')
@Controller()
export class InviteController {
  constructor(
    private readonly previewInviteUseCase: PreviewInviteUseCase,
    private readonly acceptInviteUseCase: AcceptInviteUseCase,
    private readonly createInviteUseCase: CreateInviteUseCase,
    private readonly listInvitesUseCase: ListInvitesUseCase,
    private readonly revokeInviteUseCase: RevokeInviteUseCase,
  ) {}

  @Get('invites/:token')
  @Public()
  @ApiOperation({ summary: '招待リンクのプレビュー' })
  async preview(@Param('token') token: string) {
    return this.previewInviteUseCase.execute({ token });
  }

  @Post('invites/:token/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '招待リンクを受理して会社に参加' })
  async accept(@Param('token') token: string, @CurrentUser() user: CurrentUserPayload) {
    return this.acceptInviteUseCase.execute({ token, userId: user.id });
  }

  @Get('organizations/:id/invites')
  @ApiOperation({ summary: '会社の招待リンク一覧' })
  async list(@Param('id') organizationId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.listInvitesUseCase.execute({ organizationId, requesterUserId: user.id });
  }

  @Post('organizations/:id/invites')
  @ApiOperation({ summary: '招待リンクを発行' })
  async create(
    @Param('id') organizationId: string,
    @Body() dto: CreateInviteRequestDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.createInviteUseCase.execute({
      organizationId,
      requesterUserId: user.id,
      role: dto.role,
      expiresInDays: dto.expiresInDays,
      maxUses: dto.maxUses,
    });
  }

  @Delete('organizations/:id/invites/:inviteId')
  @ApiOperation({ summary: '招待リンクを無効化' })
  async revoke(
    @Param('id') organizationId: string,
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.revokeInviteUseCase.execute({ organizationId, requesterUserId: user.id, inviteId });
    return { success: true };
  }
}
```

- [ ] **Step 4: controllers バレルに追記**

`backend/src/presentation/controllers/index.ts` の末尾に追記:

```typescript
export * from './invite.controller';
```

- [ ] **Step 5: AuthController に Google エンドポイントを追加**

`backend/src/presentation/controllers/auth.controller.ts`:

(a) import に追加 — `LoginUserUseCase` 等を import している `from '../../application'` の行に `LoginWithGoogleUseCase` を追加。
(b) `import { ... ServiceUnavailableException } from '@nestjs/common';` を先頭 import に追加（`Controller, Post, Body, Get, HttpCode, HttpStatus` の行に `ServiceUnavailableException` を足す）。
(c) `GoogleLoginRequestDto` を `from '../dto'` の import に追加。
(d) コンストラクタに `private readonly loginWithGoogleUseCase: LoginWithGoogleUseCase,` を追加。
(e) `login()` メソッドの後ろにメソッドを追加:

```typescript
  @Post('google')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Googleログイン/サインアップ' })
  @ApiResponse({ status: 200, description: 'ログイン成功' })
  @ApiResponse({ status: 401, description: 'Google認証エラー' })
  @ApiResponse({ status: 503, description: 'Googleログインが無効' })
  async google(@Body() dto: GoogleLoginRequestDto) {
    if (!process.env.GOOGLE_CLIENT_ID) {
      throw new ServiceUnavailableException('Googleログインは現在無効です');
    }
    return this.loginWithGoogleUseCase.execute({
      idToken: dto.idToken,
      inviteToken: dto.inviteToken,
    });
  }
```

- [ ] **Step 6: app.module.ts に登録**

`backend/src/app.module.ts`:
(a) application import に `PreviewInviteUseCase, AcceptInviteUseCase, CreateInviteUseCase, ListInvitesUseCase, RevokeInviteUseCase, LoginWithGoogleUseCase` を追加。
(b) presentation import に `InviteController` を追加。
(c) `controllers` 配列に `InviteController,` を追加（`AuthController,` の近く）。
(d) `providers` の Use Cases 群に追記:

```typescript
    PreviewInviteUseCase,
    AcceptInviteUseCase,
    CreateInviteUseCase,
    ListInvitesUseCase,
    RevokeInviteUseCase,
    LoginWithGoogleUseCase,
```

- [ ] **Step 7: 全テスト＋ビルド確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest "invite|google|user.entity" && npx tsc --noEmit -p tsconfig.json`
Expected: 全テスト PASS、型エラー無し。

- [ ] **Step 8: 起動して手動疎通（Google 無効時の挙動）**

Run:
```bash
cd /Users/kazuyukijimbo/ai-data-flow/backend && (npm run start:dev &) ; sleep 12 && curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:5021/api/auth/google -H 'Content-Type: application/json' -d '{"idToken":"x"}'
```
Expected: `503`（`GOOGLE_CLIENT_ID` 未設定のため）。確認後、起動した dev サーバを停止（`pkill -f "nest start" || true`）。

- [ ] **Step 9: コミット**

```bash
cd /Users/kazuyukijimbo/ai-data-flow && git add backend/src && git commit -m "feat(invite): InviteController と POST /api/auth/google を追加・DI登録"
```

---

## Task 11: フロント — Google ボタン共通コンポーネント

**Files:**
- Create: `frontend/src/components/auth/GoogleSignInButton.tsx`
- Modify: `frontend/package.json`（依存追加）

**Interfaces:**
- Produces:
  - `export const isGoogleEnabled: boolean`
  - `export function GoogleSignInButton(props: { inviteToken?: string; onAuthed: (data: GoogleAuthedData) => void; onError?: (msg: string) => void }): JSX.Element | null`
  - `export type GoogleAuthedData = { accessToken: string; user: { id: string; email: string; name: string | null }; joinedOrganizationId?: string | null }`

- [ ] **Step 1: 依存を追加**

Run:
```bash
cd /Users/kazuyukijimbo/ai-data-flow/frontend && pnpm add @react-oauth/google
```
Expected: `@react-oauth/google` が dependencies に入る。

- [ ] **Step 2: コンポーネントを作成**

Create `frontend/src/components/auth/GoogleSignInButton.tsx`:

```tsx
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
    <GoogleOAuthProvider clientId={CLIENT_ID}>
      <GoogleLogin
        locale="ja"
        text="signin_with"
        width="320"
        onSuccess={async (cred) => {
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
```

- [ ] **Step 3: 型チェック**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/frontend && npx tsc --noEmit -p tsconfig.json`
Expected: 型エラー無し。

- [ ] **Step 4: コミット**

```bash
cd /Users/kazuyukijimbo/ai-data-flow && git add frontend/src/components/auth frontend/package.json frontend/pnpm-lock.yaml && git commit -m "feat(auth-ui): env-gate な GoogleSignInButton を追加"
```

---

## Task 12: フロント — API クライアント拡張（google + invites）

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Produces:
  - `authApi.google(idToken: string, inviteToken?: string)`
  - `export interface InviteView { id; token; role; expiresAt: string|null; maxUses: number|null; useCount: number; revoked: boolean; valid: boolean }`
  - `invitesApi.preview(token)`, `invitesApi.accept(token)`, `invitesApi.list(orgId)`, `invitesApi.create(orgId, body)`, `invitesApi.revoke(orgId, inviteId)`

- [ ] **Step 1: authApi に google を追加**

`frontend/src/lib/api.ts` の `authApi` オブジェクト内、`me: () => api<any>('/auth/me'),` の前に追加:

```typescript
  google: (idToken: string, inviteToken?: string) =>
    api<{
      accessToken: string
      user: { id: string; email: string; name: string | null }
      joinedOrganizationId: string | null
    }>('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken, inviteToken }),
      auth: false,
    }),
```

- [ ] **Step 2: invitesApi と InviteView を追加**

`frontend/src/lib/api.ts` の `organizationsApi` の定義ブロックの直後に追加:

```typescript
// Invites
export interface InviteView {
  id: string
  token: string
  role: string
  expiresAt: string | null
  maxUses: number | null
  useCount: number
  revoked: boolean
  valid: boolean
}

export interface InvitePreview {
  valid: boolean
  reason: string | null
  organizationName: string | null
  role: string | null
}

export const invitesApi = {
  preview: (token: string) =>
    api<InvitePreview>(`/invites/${token}`, { auth: false }),
  accept: (token: string) =>
    api<{ organizationId: string; alreadyMember: boolean }>(`/invites/${token}/accept`, {
      method: 'POST',
    }),
  list: (orgId: string) => api<InviteView[]>(`/organizations/${orgId}/invites`),
  create: (orgId: string, body: { role?: string; expiresInDays?: number; maxUses?: number }) =>
    api<InviteView>(`/organizations/${orgId}/invites`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  revoke: (orgId: string, inviteId: string) =>
    api<{ success: boolean }>(`/organizations/${orgId}/invites/${inviteId}`, { method: 'DELETE' }),
}
```

- [ ] **Step 3: 型チェック**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/frontend && npx tsc --noEmit -p tsconfig.json`
Expected: 型エラー無し。

- [ ] **Step 4: コミット**

```bash
cd /Users/kazuyukijimbo/ai-data-flow && git add frontend/src/lib/api.ts && git commit -m "feat(api): authApi.google と invitesApi を追加"
```

---

## Task 13: フロント — ログイン/登録ページに Google ボタン

**Files:**
- Modify: `frontend/src/app/(auth)/login/page.tsx`, `frontend/src/app/(auth)/register/page.tsx`

**Interfaces:**
- Consumes: `GoogleSignInButton`, `isGoogleEnabled`（Task 11）。

- [ ] **Step 1: login ページに import を追加**

`frontend/src/app/(auth)/login/page.tsx` の import 群（`import { Label } ...` の下）に追加:

```typescript
import { GoogleSignInButton, isGoogleEnabled } from '@/components/auth/GoogleSignInButton';
```

- [ ] **Step 2: login ページにボタンブロックを挿入**

`</form>` と `<p className="mt-6 text-center text-sm text-gray-500">` の間に挿入:

```tsx
        {isGoogleEnabled && (
          <div className="mt-6">
            <div className="relative flex items-center justify-center">
              <span className="absolute inset-x-0 top-1/2 h-px bg-gray-200" />
              <span className="relative bg-white px-3 text-xs text-gray-400">または</span>
            </div>
            <div className="mt-4 flex justify-center">
              <GoogleSignInButton
                onAuthed={() => router.push('/dashboard')}
                onError={(msg) => setError(msg)}
              />
            </div>
          </div>
        )}
```

- [ ] **Step 3: register ページに import を追加**

`frontend/src/app/(auth)/register/page.tsx` の import 群に追加:

```typescript
import { GoogleSignInButton, isGoogleEnabled } from '@/components/auth/GoogleSignInButton';
```

- [ ] **Step 4: register ページにボタンブロックを挿入**

`</form>` と `<p className="mt-6 text-center text-sm text-gray-500">` の間に、Step 2 と同じブロックを挿入（`onAuthed={() => router.push('/dashboard')}`）。

- [ ] **Step 5: 型チェック ＋ ビルド**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/frontend && npx tsc --noEmit -p tsconfig.json`
Expected: 型エラー無し。

- [ ] **Step 6: 手動確認（Google 無効時はボタン非表示）**

`NEXT_PUBLIC_GOOGLE_CLIENT_ID` 未設定で `pnpm dev` 起動、`/login` を開き「メアドフォームのみ」「『または』区切りと Google ボタンが出ない」ことを確認。

- [ ] **Step 7: コミット**

```bash
cd /Users/kazuyukijimbo/ai-data-flow && git add "frontend/src/app/(auth)" && git commit -m "feat(auth-ui): ログイン/登録に Google ボタンを追加(env-gate)"
```

---

## Task 14: フロント — 招待受理ページ `/invite/[token]`

**Files:**
- Create: `frontend/src/app/invite/[token]/page.tsx`

**Interfaces:**
- Consumes: `invitesApi.preview/accept`（Task 12）、`GoogleSignInButton`/`isGoogleEnabled`（Task 11）、`authApi`（既存 login/register は直接 fetch 利用）。

- [ ] **Step 1: ページを作成**

Create `frontend/src/app/invite/[token]/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Database, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { invitesApi, type InvitePreview } from '@/lib/api';
import { GoogleSignInButton, isGoogleEnabled } from '@/components/auth/GoogleSignInButton';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';
const NAVY = '#050f3e';

const REASON_TEXT: Record<string, string> = {
  notfound: 'この招待リンクは存在しません。',
  revoked: 'この招待リンクは無効化されています。',
  expired: 'この招待リンクは有効期限が切れています。',
  maxed: 'この招待リンクは利用上限に達しています。',
};

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = (params?.token as string) || '';

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [hasToken, setHasToken] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setHasToken(Boolean(typeof window !== 'undefined' && localStorage.getItem('accessToken')));
    invitesApi
      .preview(token)
      .then(setPreview)
      .catch(() => setPreview({ valid: false, reason: 'notfound', organizationName: null, role: null }))
      .finally(() => setLoadingPreview(false));
  }, [token]);

  // 認証後に招待を受理して会社へ
  async function acceptAndGo() {
    setBusy(true);
    setError('');
    try {
      const { organizationId } = await invitesApi.accept(token);
      localStorage.setItem('selectedOrganizationId', organizationId);
      router.push('/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : '参加に失敗しました');
      setBusy(false);
    }
  }

  // メアドで login or register → accept
  async function onEmailSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    const email = fd.get('email') as string;
    const password = fd.get('password') as string;
    const name = (fd.get('name') as string) || undefined;
    const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'login' ? { email, password } : { email, password, name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || '認証に失敗しました');
      }
      const data = await res.json();
      localStorage.setItem('accessToken', data.accessToken);
      await acceptAndGo();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
      setBusy(false);
    }
  }

  function Shell({ children }: { children: React.ReactNode }) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 text-gray-900">
        <div className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl shadow-sm p-8">
          <div className="flex flex-col items-center mb-6 text-center">
            <span className="w-10 h-10 rounded-lg flex items-center justify-center text-white mb-3" style={{ backgroundColor: NAVY }}>
              <Database className="h-5 w-5" />
            </span>
            <h1 className="text-xl font-bold tracking-tight" style={{ color: NAVY }}>Brain Pro</h1>
          </div>
          {children}
        </div>
      </div>
    );
  }

  if (loadingPreview) {
    return (
      <Shell>
        <div className="flex justify-center py-6 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </Shell>
    );
  }

  if (!preview || !preview.valid) {
    return (
      <Shell>
        <p className="text-center text-sm text-red-600">
          {REASON_TEXT[preview?.reason ?? 'notfound'] ?? '無効な招待リンクです。'}
        </p>
        <p className="mt-6 text-center text-sm text-gray-500">
          <Link href="/login" className="font-medium" style={{ color: '#2563eb' }}>ログインへ</Link>
        </p>
      </Shell>
    );
  }

  // 有効な招待
  return (
    <Shell>
      <p className="mb-5 text-center text-sm text-gray-600">
        <span className="font-semibold text-gray-900">{preview.organizationName}</span> に招待されています
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">{error}</div>
      )}

      {hasToken ? (
        <div className="space-y-3">
          <Button
            onClick={acceptAndGo}
            disabled={busy}
            className="w-full rounded-full font-bold text-white hover:opacity-90"
            style={{ backgroundColor: NAVY }}
          >
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            ログイン中のアカウントで参加する
          </Button>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem('accessToken');
              setHasToken(false);
            }}
            className="w-full text-center text-xs text-gray-500 hover:text-gray-700"
          >
            別のアカウントでログインする
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {isGoogleEnabled && (
            <>
              <div className="flex justify-center">
                <GoogleSignInButton
                  inviteToken={token}
                  onAuthed={(d) => {
                    if (d.joinedOrganizationId) {
                      localStorage.setItem('selectedOrganizationId', d.joinedOrganizationId);
                    }
                    router.push('/dashboard');
                  }}
                  onError={(msg) => setError(msg)}
                />
              </div>
              <div className="relative flex items-center justify-center">
                <span className="absolute inset-x-0 top-1/2 h-px bg-gray-200" />
                <span className="relative bg-white px-3 text-xs text-gray-400">または</span>
              </div>
            </>
          )}

          <form onSubmit={onEmailSubmit} className="space-y-3">
            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-gray-700 text-sm">お名前</Label>
                <Input id="name" name="name" type="text" required placeholder="山田 太郎" className="bg-white border-gray-300 text-gray-900" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-gray-700 text-sm">メールアドレス</Label>
              <Input id="email" name="email" type="email" required placeholder="you@example.com" className="bg-white border-gray-300 text-gray-900" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-gray-700 text-sm">パスワード</Label>
              <Input id="password" name="password" type="password" required minLength={mode === 'register' ? 8 : 1} placeholder={mode === 'register' ? '8文字以上' : ''} className="bg-white border-gray-300 text-gray-900" />
            </div>
            <Button type="submit" disabled={busy} className="w-full rounded-full font-bold text-white hover:opacity-90" style={{ backgroundColor: NAVY }}>
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {mode === 'login' ? 'ログインして参加' : '登録して参加'}
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500">
            {mode === 'login' ? (
              <>アカウントが無い方は{' '}
                <button type="button" onClick={() => setMode('register')} className="font-medium" style={{ color: '#2563eb' }}>新規登録</button>
              </>
            ) : (
              <>すでにアカウントをお持ちの方は{' '}
                <button type="button" onClick={() => setMode('login')} className="font-medium" style={{ color: '#2563eb' }}>ログイン</button>
              </>
            )}
          </p>
        </div>
      )}
    </Shell>
  );
}
```

- [ ] **Step 2: 型チェック**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/frontend && npx tsc --noEmit -p tsconfig.json`
Expected: 型エラー無し。

- [ ] **Step 3: コミット**

```bash
cd /Users/kazuyukijimbo/ai-data-flow && git add frontend/src/app/invite && git commit -m "feat(invite-ui): 招待受理ページ /invite/[token] を追加"
```

---

## Task 15: フロント — ProjectContext に会社選択の永続化

**Files:**
- Modify: `frontend/src/contexts/ProjectContext.tsx`

**Interfaces:**
- Produces: リロードしても `selectedOrganization` が `localStorage['selectedOrganizationId']` から復元される。`selectOrganization` 呼び出しで永続化される。

- [ ] **Step 1: fetchOrganizations に復元ロジックを追加**

`frontend/src/contexts/ProjectContext.tsx` の `fetchOrganizations` 内、`setOrganizations(data);` 以降の自動選択ブロックを次に置き換え:

```typescript
        setOrganizations(data);
        // 復元: 保存済み organizationId が一覧にあれば選択、無ければ1つの時だけ自動選択
        const savedId = typeof window !== 'undefined' ? localStorage.getItem('selectedOrganizationId') : null;
        const saved = savedId ? data.find((o: Organization) => o.id === savedId) : null;
        if (saved) {
          setSelectedOrganization(saved);
        } else if (data.length === 1) {
          setSelectedOrganization(data[0]);
          localStorage.setItem('selectedOrganizationId', data[0].id);
        }
```

- [ ] **Step 2: selectOrganization に永続化を追加**

`selectOrganization` の本体を次に置き換え:

```typescript
  const selectOrganization = useCallback((org: Organization) => {
    setSelectedOrganization(org);
    localStorage.setItem('selectedOrganizationId', org.id);
    setSelectedProject(null);
    setProjects([]);
    localStorage.removeItem('selectedProjectId');
    fetchProjects(org.id);
  }, [fetchProjects]);
```

- [ ] **Step 3: 型チェック**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/frontend && npx tsc --noEmit -p tsconfig.json`
Expected: 型エラー無し。

- [ ] **Step 4: コミット**

```bash
cd /Users/kazuyukijimbo/ai-data-flow && git add frontend/src/contexts/ProjectContext.tsx && git commit -m "feat(org): 選択中の会社を localStorage に永続化・復元"
```

---

## Task 16: フロント — 会社スイッチャー（ProjectProvider マウント + UI）

**Files:**
- Create: `frontend/src/components/company/CompanySwitcher.tsx`
- Modify: `frontend/src/components/providers.tsx`, `frontend/src/app/(dashboard)/layout.tsx`

**Interfaces:**
- Consumes: `useProject()`（Task 15 の `ProjectContext`）。
- Produces: ダッシュボードのサイドバーに会社切替ドロップダウンが表示される。

- [ ] **Step 1: providers に ProjectProvider をマウント**

`frontend/src/components/providers.tsx`:
(a) import を追加（`import { useState } ...` の下）:

```typescript
import { ProjectProvider } from '@/contexts/ProjectContext'
```

(b) JSX を次に変更（`QueryClientProvider` の内側を `ProjectProvider` で包む）:

```tsx
  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <ProjectProvider>{children}</ProjectProvider>
      </QueryClientProvider>
    </SessionProvider>
  )
```

- [ ] **Step 2: CompanySwitcher を作成**

Create `frontend/src/components/company/CompanySwitcher.tsx`:

```tsx
'use client';

import { Building2, Check, ChevronDown } from 'lucide-react';
import { useProject } from '@/contexts/ProjectContext';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

/**
 * 所属会社を切り替えるドロップダウン。会社が無ければ何も表示しない。
 */
export function CompanySwitcher() {
  const { organizations, selectedOrganization, selectOrganization } = useProject();

  if (!organizations || organizations.length === 0) return null;

  return (
    <div className="px-3 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="w-full flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-left text-sm hover:bg-secondary transition-colors">
            <Building2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span className="truncate flex-1 text-foreground">
              {selectedOrganization?.name ?? '会社を選択'}
            </span>
            <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>会社を切り替え</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {organizations.map((org) => (
            <DropdownMenuItem
              key={org.id}
              onClick={() => selectOrganization(org)}
              className="flex items-center gap-2"
            >
              <Check
                className={
                  'h-4 w-4 ' + (selectedOrganization?.id === org.id ? 'opacity-100' : 'opacity-0')
                }
              />
              <span className="truncate">{org.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

- [ ] **Step 2.5: フォールバック注記**

`CompanySwitcher` は `useProject()` を使うため、必ず `ProjectProvider` 配下（= ダッシュボード）でのみ描画する。Step 1 で `Providers` 全体を包んだので、`(dashboard)/layout.tsx` 内での使用は安全。

- [ ] **Step 3: layout のサイドバーに挿入**

`frontend/src/app/(dashboard)/layout.tsx`:
(a) import 追加（先頭の import 群に）:

```typescript
import { CompanySwitcher } from '@/components/company/CompanySwitcher'
```

(b) サイドバーのロゴブロック（`PanelLeftClose` ボタンを含む `<div className="flex items-center justify-between px-4 py-4 border-b border-border">...</div>`）の **直後** に `<CompanySwitcher />` を挿入する。この div はサイドバーのロゴ（プロジェクト名 or "Brain Pro"）を表示している箇所。挿入後の並びは「ロゴ → CompanySwitcher → ナビゲーション」。

```tsx
          <CompanySwitcher />
```

- [ ] **Step 4: 型チェック ＋ ビルド**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/frontend && npx tsc --noEmit -p tsconfig.json`
Expected: 型エラー無し。

- [ ] **Step 5: 手動確認**

`pnpm dev` 起動 → ログイン → ダッシュボードのサイドバー上部に会社名スイッチャーが出る。複数会社に所属している場合、切替で選択が変わり localStorage `selectedOrganizationId` が更新されることを確認（DevTools）。

- [ ] **Step 6: コミット**

```bash
cd /Users/kazuyukijimbo/ai-data-flow && git add frontend/src/components/company frontend/src/components/providers.tsx "frontend/src/app/(dashboard)/layout.tsx" && git commit -m "feat(org): 会社スイッチャーを追加し ProjectProvider をマウント"
```

---

## Task 17: フロント — 会社設定ページに招待リンク管理 UI

**Files:**
- Create: `frontend/src/components/company/InviteLinksPanel.tsx`
- Modify: `frontend/src/app/(dashboard)/dashboard/companies/[orgId]/page.tsx`

**Interfaces:**
- Consumes: `invitesApi`（Task 12）。
- Produces: 会社設定「メンバー」タブで招待リンクの発行・一覧・コピー・無効化ができる。

- [ ] **Step 1: InviteLinksPanel を作成**

Create `frontend/src/components/company/InviteLinksPanel.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2, Plus, Trash2, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { invitesApi, type InviteView } from '@/lib/api';

const ROLE_OPTIONS = [
  { value: 'MEMBER', label: '一般ユーザー' },
  { value: 'ADMIN', label: '会社管理者' },
  { value: 'VIEWER', label: '閲覧のみ' },
];

function inviteUrl(token: string): string {
  if (typeof window === 'undefined') return `/invite/${token}`;
  return `${window.location.origin}/invite/${token}`;
}

/**
 * 会社の招待リンク管理パネル（発行・一覧・コピー・無効化）。
 */
export function InviteLinksPanel({ orgId }: { orgId: string }) {
  const [invites, setInvites] = useState<InviteView[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [role, setRole] = useState('MEMBER');
  const [expiresInDays, setExpiresInDays] = useState('7');
  const [maxUses, setMaxUses] = useState('');
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInvites(await invitesApi.list(orgId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    setCreating(true);
    setError('');
    try {
      await invitesApi.create(orgId, {
        role,
        expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
        maxUses: maxUses ? Number(maxUses) : undefined,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '発行に失敗しました');
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    setError('');
    try {
      await invitesApi.revoke(orgId, id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '無効化に失敗しました');
    }
  }

  async function copy(token: string, id: string) {
    await navigator.clipboard.writeText(inviteUrl(token));
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="space-y-4 rounded-xl border border-border p-4">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold text-foreground">招待リンク</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        リンクを知っている人は誰でもこの会社に参加できます。期限・利用上限を設定し、不要になったら無効化してください。
      </p>

      {error && (
        <div className="p-2 rounded bg-red-50 border border-red-200 text-red-600 text-sm">{error}</div>
      )}

      {/* 発行フォーム */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
        <div className="space-y-1.5">
          <Label className="text-xs">ロール</Label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">有効日数（空=無期限）</Label>
          <Input type="number" min={1} value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">最大利用回数（空=無制限）</Label>
          <Input type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
        </div>
        <Button onClick={create} disabled={creating} className="gap-1">
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          発行
        </Button>
      </div>

      {/* 一覧 */}
      {loading ? (
        <div className="flex justify-center py-4 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : invites.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">招待リンクはまだありません。</p>
      ) : (
        <ul className="space-y-2">
          {invites.map((inv) => (
            <li key={inv.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className={'inline-block rounded px-2 py-0.5 text-xs ' + (inv.valid ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500')}>
                {inv.revoked ? '無効' : inv.valid ? '有効' : '失効'}
              </span>
              <span className="rounded bg-secondary px-2 py-0.5 text-xs">{inv.role}</span>
              <span className="text-xs text-muted-foreground">
                {inv.expiresAt ? `期限: ${new Date(inv.expiresAt).toLocaleDateString('ja-JP')}` : '無期限'} ・ {inv.maxUses != null ? `${inv.useCount}/${inv.maxUses}` : `${inv.useCount}回`}
              </span>
              <div className="flex-1" />
              <button onClick={() => copy(inv.token, inv.id)} title="リンクをコピー" className="p-1.5 rounded hover:bg-secondary text-muted-foreground">
                {copiedId === inv.id ? <span className="text-xs text-green-600">コピー済</span> : <Copy className="h-4 w-4" />}
              </button>
              {!inv.revoked && (
                <button onClick={() => revoke(inv.id)} title="無効化" className="p-1.5 rounded hover:bg-red-50 text-red-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 会社設定ページに挿入**

`frontend/src/app/(dashboard)/dashboard/companies/[orgId]/page.tsx`:
(a) import 群に追加:

```typescript
import { InviteLinksPanel } from '@/components/company/InviteLinksPanel'
```

(b) 「メンバー」タブのコンテンツ領域（メンバー追加フォーム/一覧をレンダリングしている JSX ブロック）の先頭付近に、会社 ID を渡して挿入する。会社 ID はこのページが既に保持している変数（`orgId` または `params.orgId`）を使う:

```tsx
<InviteLinksPanel orgId={orgId} />
```

※ このページの会社 ID 変数名が `orgId` でない場合（例: `params.orgId` を直接使用）、その式に合わせること。メンバータブの判定（`activeTab === 'members'` 等）の内側に置く。

- [ ] **Step 3: 型チェック ＋ ビルド**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/frontend && npx tsc --noEmit -p tsconfig.json`
Expected: 型エラー無し。

- [ ] **Step 4: 手動確認（E2E）**

`GOOGLE_CLIENT_ID` 未設定のまま、バックエンド＋フロント起動。会社管理者で `/dashboard/companies/<id>` のメンバータブを開き、(1) 招待リンクを発行 → 一覧に出る、(2) コピー、(3) 別ブラウザ/シークレットでそのURLを開き、メアド新規登録 → ダッシュボードに会社が選択された状態で入れる、(4) 無効化したリンクは `/invite/<token>` で「無効化されています」と出る、を確認。

- [ ] **Step 5: コミット**

```bash
cd /Users/kazuyukijimbo/ai-data-flow && git add frontend/src/components/company "frontend/src/app/(dashboard)/dashboard/companies" && git commit -m "feat(invite-ui): 会社設定に招待リンク管理パネルを追加"
```

---

## Task 18: 仕上げ — 環境変数ドキュメント ＋ 全体回帰

**Files:**
- Modify: `backend/.env.example`（無ければ作成）, `frontend/.env.example`（無ければ作成）

**Interfaces:**
- Produces: Google を有効化するための env を文書化。

- [ ] **Step 1: backend env サンプルに追記**

`backend/.env.example`（無ければ新規作成）に追記（既存キーは保持）:

```bash
# Google ログイン用 OAuth クライアントID（未設定なら Google ログインは無効=503）
GOOGLE_CLIENT_ID=
```

- [ ] **Step 2: frontend env サンプルに追記**

`frontend/.env.example`（無ければ新規作成）に追記:

```bash
NEXT_PUBLIC_API_URL=http://localhost:5021
# Google ログイン用 OAuth クライアントID（未設定なら Google ボタン非表示）
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
```

- [ ] **Step 3: バックエンド全テスト**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest`
Expected: 既存テスト含め全 PASS（新規 invite/google/user.entity スペックを含む）。

- [ ] **Step 4: 両側ビルド**

Run:
```bash
cd /Users/kazuyukijimbo/ai-data-flow/backend && npx tsc --noEmit -p tsconfig.json && cd /Users/kazuyukijimbo/ai-data-flow/frontend && npx tsc --noEmit -p tsconfig.json
```
Expected: 型エラー無し。

- [ ] **Step 5: コミット**

```bash
cd /Users/kazuyukijimbo/ai-data-flow && git add backend/.env.example frontend/.env.example && git commit -m "docs(env): Google ログイン用の環境変数を .env.example に追記"
```

---

## 完了後のフォローアップ（手動・別途）

- **Google Cloud で OAuth クライアントID 作成**: 承認済み JavaScript 生成元（例: `http://localhost:3000`, 本番ドメイン）を登録 → `GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` に同じ値を設定 → Google ボタンが自動的に有効化。
- **本番デプロイ**: マイグレーション（`prisma migrate deploy`）を本番 DB に適用。

## Spec カバレッジ確認（self-review 結果）

- 共有招待リンク（会社+ロール・期限・最大回数・revoke）→ Task 1,3,6,7,8,10,17 ✅
- 招待→ログイン動線（Google/メアド・ログイン/新規登録）→ Task 14 ✅
- 複数会社所属＆切替 → Task 15,16（M2M は既存）✅
- Google ログイン（env-gate、既存JWT維持、ID トークン検証、アカウントリンク）→ Task 5,9,10,11,13 ✅
- メアド ログイン/新規登録維持・空パス拒否 → 既存実装（変更不要、Task で温存）✅
- 機微情報を返さない公開プレビュー → Task 8 ✅
