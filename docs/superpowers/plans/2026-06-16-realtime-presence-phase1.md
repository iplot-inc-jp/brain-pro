# Realtime Presence Phase 1 (Liveblocks who's-online + live cursors) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hosted Liveblocks presence (per-project "who's online" avatar stack + same-page live cursors) to ai-data-flow, with tokens minted by an authenticated NestJS endpoint that reuses the existing JWT auth + project RBAC, and the Liveblocks secret key never reaching the browser.

**Architecture:** A new `POST /api/liveblocks/token` endpoint (behind the global `JwtAuthGuard`) resolves project access via `ProjectAccessService`, fetches lean identity via `UserRepository`, assigns a deterministic color, and mints a Liveblocks access token via `@liveblocks/node`. The frontend wraps the existing `[projectId]/layout.tsx` in one `RoomProvider` (room id `project:{projectId}`) so all ~35 project pages inherit presence; cursors are viewport-relative (`clientX/clientY`) on a single `fixed inset-0` overlay, filtered to peers on the same sub-page. Pure logic (color, room-id, cursor-filter, dedupe, initials) lives in unit-tested helpers; Liveblocks-hook components stay thin.

**Tech Stack:** NestJS 10 + Prisma + jest (backend); Next.js 14 App Router + React 18.2 + vitest (frontend); `@liveblocks/node` (backend), `@liveblocks/client` + `@liveblocks/react` (frontend, v2 `createRoomContext` API).

**Branch:** `feat/methodology-pipeline` (commit only here; never create new branches).

**Spec:** `docs/superpowers/specs/2026-06-16-realtime-presence-phase1-design.md`

---

## File Structure

**Backend (new)**
- `backend/src/infrastructure/services/presence-colors.ts` — color palette + `deterministicColor(userId)` (pure; source of truth for color).
- `backend/src/infrastructure/services/liveblocks-token.service.ts` — `@Injectable` wrapper around `@liveblocks/node`; reads `process.env.LIVEBLOCKS_SECRET_KEY` (mirrors `BlobStorageService` env-getter pattern); `mintToken(...)`.
- `backend/src/application/use-cases/liveblocks/issue-liveblocks-token.use-case.ts` — RBAC gate + identity + color + mint.
- `backend/src/presentation/controllers/liveblocks.controller.ts` — `POST /liveblocks/token` (inline DTO, `@Res({passthrough})`).

**Backend (modified)**
- `backend/src/app.module.ts` — register controller + 2 providers.
- `backend/package.json` — add `@liveblocks/node`.

**Frontend (new)**
- `frontend/src/lib/presence-helpers.ts` — pure helpers (room id, cursor filter, dedupe, initials, color mirror).
- `frontend/src/lib/liveblocks.config.ts` — `createClient` + `authEndpoint` + typed `createRoomContext`.
- `frontend/src/components/presence/PresencePageSync.tsx`
- `frontend/src/components/presence/WhoIsOnline.tsx`
- `frontend/src/components/presence/LiveCursors.tsx`

**Frontend (modified)**
- `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/layout.tsx` — wrap existing tree in `RoomProvider` + mount presence components.
- `frontend/package.json` — add `@liveblocks/client`, `@liveblocks/react`.

**Ops**
- `backend/.env.example` (if present) + Vercel backend env — `LIVEBLOCKS_SECRET_KEY`.
- `frontend/package.json` script `check:secrets` — CI grep guard.

> Note vs spec: the request DTO is inlined in the controller (matching the existing `SetMemberAccessDto` pattern in `project-member.controller.ts`) rather than a separate file; an explicit `LiveblocksTokenService` wraps the SDK for testability; the frontend color mirror lives inside `presence-helpers.ts`. These are refinements, not scope changes.

---

## Task 1: Deterministic presence color (backend, pure)

**Files:**
- Create: `backend/src/infrastructure/services/presence-colors.ts`
- Test: `backend/src/infrastructure/services/presence-colors.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/infrastructure/services/presence-colors.spec.ts
import { PRESENCE_COLORS, deterministicColor } from './presence-colors';

describe('deterministicColor', () => {
  it('returns a color from the palette', () => {
    expect(PRESENCE_COLORS).toContain(deterministicColor('user-abc'));
  });

  it('is stable for the same id', () => {
    expect(deterministicColor('user-abc')).toBe(deterministicColor('user-abc'));
  });

  it('handles empty string without throwing', () => {
    expect(PRESENCE_COLORS).toContain(deterministicColor(''));
  });

  it('spreads different ids across the palette (not all identical)', () => {
    const colors = new Set(
      Array.from({ length: 50 }, (_, i) => deterministicColor(`user-${i}`)),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest presence-colors`
Expected: FAIL — cannot find module `./presence-colors`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/infrastructure/services/presence-colors.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest presence-colors`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/infrastructure/services/presence-colors.ts backend/src/infrastructure/services/presence-colors.spec.ts
git commit -m "feat(presence): deterministic presence color palette (backend)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: LiveblocksTokenService (backend SDK wrapper)

**Files:**
- Create: `backend/src/infrastructure/services/liveblocks-token.service.ts`
- Test: `backend/src/infrastructure/services/liveblocks-token.service.spec.ts`
- Modify: `backend/package.json` (add `@liveblocks/node`)

- [ ] **Step 1: Install the SDK**

Run: `cd backend && npm install @liveblocks/node@^2`
Expected: `@liveblocks/node` appears in `backend/package.json` dependencies.

- [ ] **Step 2: Write the failing test**

```ts
// backend/src/infrastructure/services/liveblocks-token.service.spec.ts
import { LiveblocksTokenService } from './liveblocks-token.service';

describe('LiveblocksTokenService', () => {
  const ORIGINAL = process.env.LIVEBLOCKS_SECRET_KEY;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.LIVEBLOCKS_SECRET_KEY;
    else process.env.LIVEBLOCKS_SECRET_KEY = ORIGINAL;
  });

  it('isConfigured reflects the env var', () => {
    const svc = new LiveblocksTokenService();
    delete process.env.LIVEBLOCKS_SECRET_KEY;
    expect(svc.isConfigured).toBe(false);
    process.env.LIVEBLOCKS_SECRET_KEY = 'sk_test_x';
    expect(svc.isConfigured).toBe(true);
  });

  it('mintToken throws a clear error when the secret is not configured', async () => {
    const svc = new LiveblocksTokenService();
    delete process.env.LIVEBLOCKS_SECRET_KEY;
    await expect(
      svc.mintToken({
        userId: 'u1',
        userInfo: { name: 'A', email: 'a@x.com', avatarUrl: null, color: '#fff' },
        roomId: 'project:p1',
        fullAccess: true,
      }),
    ).rejects.toThrow(/LIVEBLOCKS_SECRET_KEY/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx jest liveblocks-token.service`
Expected: FAIL — cannot find module `./liveblocks-token.service`.

- [ ] **Step 4: Write minimal implementation**

```ts
// backend/src/infrastructure/services/liveblocks-token.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Liveblocks } from '@liveblocks/node';

export interface MintTokenParams {
  userId: string;
  userInfo: { name: string; email: string; avatarUrl: string | null; color: string };
  roomId: string;
  fullAccess: boolean;
}

/**
 * @liveblocks/node を包む薄いラッパ。秘密鍵は process.env.LIVEBLOCKS_SECRET_KEY から取得
 * （BlobStorageService と同じ env-getter 方式）。未設定なら mintToken は明示的に throw し、
 * フロント側はトークン取得失敗としてプレゼンスをグレースフルに無効化する。
 */
@Injectable()
export class LiveblocksTokenService {
  private readonly logger = new Logger(LiveblocksTokenService.name);
  private client: Liveblocks | null = null;

  get isConfigured(): boolean {
    const s = process.env.LIVEBLOCKS_SECRET_KEY;
    return !!(s && s.trim());
  }

  private getClient(): Liveblocks {
    const secret = process.env.LIVEBLOCKS_SECRET_KEY;
    if (!secret || !secret.trim()) {
      throw new Error('LIVEBLOCKS_SECRET_KEY is not configured');
    }
    if (!this.client) {
      this.client = new Liveblocks({ secret: secret.trim() });
    }
    return this.client;
  }

  async mintToken(params: MintTokenParams): Promise<{ body: string; status: number }> {
    const liveblocks = this.getClient();
    const session = liveblocks.prepareSession(params.userId, {
      userInfo: params.userInfo,
    });
    session.allow(
      params.roomId,
      params.fullAccess ? session.FULL_ACCESS : session.READ_ACCESS,
    );
    const { body, status } = await session.authorize();
    return { body, status };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx jest liveblocks-token.service`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/infrastructure/services/liveblocks-token.service.ts backend/src/infrastructure/services/liveblocks-token.service.spec.ts backend/package.json backend/package-lock.json
git commit -m "feat(presence): LiveblocksTokenService wrapping @liveblocks/node

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: IssueLiveblocksTokenUseCase (backend, RBAC gate)

**Files:**
- Create: `backend/src/application/use-cases/liveblocks/issue-liveblocks-token.use-case.ts`
- Test: `backend/src/application/use-cases/liveblocks/issue-liveblocks-token.use-case.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/application/use-cases/liveblocks/issue-liveblocks-token.use-case.spec.ts
import { ForbiddenError } from '../../../domain';
import { IssueLiveblocksTokenUseCase } from './issue-liveblocks-token.use-case';

function makeDeps(opts?: {
  level?: 'EDIT' | 'VIEW' | null;
  user?: { email: string; name: string | null; avatarUrl: string | null } | null;
}) {
  const userRepository = {
    findById: jest.fn(async () =>
      opts?.user === undefined
        ? { email: 'alice@example.com', name: 'Alice', avatarUrl: 'http://img/a.png' }
        : opts.user,
    ),
  };
  const projectAccess = {
    resolveProjectAccess: jest.fn(async () =>
      opts?.level === undefined ? 'EDIT' : opts.level,
    ),
  };
  const liveblocks = {
    mintToken: jest.fn(async () => ({ body: '{"token":"t"}', status: 200 })),
  };
  return { userRepository, projectAccess, liveblocks };
}

function makeUseCase(d: ReturnType<typeof makeDeps>) {
  return new IssueLiveblocksTokenUseCase(
    d.userRepository as any,
    d.projectAccess as any,
    d.liveblocks as any,
  );
}

describe('IssueLiveblocksTokenUseCase', () => {
  it('rejects API-key callers', async () => {
    const d = makeDeps();
    await expect(
      makeUseCase(d).execute({ userId: 'u1', apiKeyId: 'k1', projectId: 'p1' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(d.projectAccess.resolveProjectAccess).not.toHaveBeenCalled();
  });

  it('rejects when the user has no project access', async () => {
    const d = makeDeps({ level: null });
    await expect(
      makeUseCase(d).execute({ userId: 'u1', projectId: 'p1' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('mints with FULL_ACCESS for EDIT and a project:{id} room', async () => {
    const d = makeDeps({ level: 'EDIT' });
    const out = await makeUseCase(d).execute({ userId: 'u1', projectId: 'p1' });
    expect(out).toEqual({ body: '{"token":"t"}', status: 200 });
    const arg = d.liveblocks.mintToken.mock.calls[0][0];
    expect(arg.fullAccess).toBe(true);
    expect(arg.roomId).toBe('project:p1');
    expect(arg.userInfo.name).toBe('Alice');
    expect(arg.userInfo.email).toBe('alice@example.com');
    expect(arg.userInfo.avatarUrl).toBe('http://img/a.png');
    expect(typeof arg.userInfo.color).toBe('string');
  });

  it('mints with read access (fullAccess=false) for VIEW', async () => {
    const d = makeDeps({ level: 'VIEW' });
    await makeUseCase(d).execute({ userId: 'u1', projectId: 'p1' });
    expect(d.liveblocks.mintToken.mock.calls[0][0].fullAccess).toBe(false);
  });

  it('falls back to the email local-part when name is null', async () => {
    const d = makeDeps({ level: 'EDIT', user: { email: 'bob@example.com', name: null, avatarUrl: null } });
    await makeUseCase(d).execute({ userId: 'u1', projectId: 'p1' });
    expect(d.liveblocks.mintToken.mock.calls[0][0].userInfo.name).toBe('bob');
  });

  it('rejects when the user record is missing', async () => {
    const d = makeDeps({ level: 'EDIT', user: null });
    await expect(
      makeUseCase(d).execute({ userId: 'u1', projectId: 'p1' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest issue-liveblocks-token`
Expected: FAIL — cannot find module `./issue-liveblocks-token.use-case`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/application/use-cases/liveblocks/issue-liveblocks-token.use-case.ts
import { Inject, Injectable } from '@nestjs/common';
import { UserRepository, USER_REPOSITORY, ForbiddenError } from '../../../domain';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import { LiveblocksTokenService } from '../../../infrastructure/services/liveblocks-token.service';
import { deterministicColor } from '../../../infrastructure/services/presence-colors';

export interface IssueLiveblocksTokenInput {
  userId: string;
  apiKeyId?: string;
  projectId: string;
}

/**
 * Liveblocks プレゼンス用トークン発行。
 * - API キー呼び出しは拒否（プレゼンスは対話的ブラウザ専用）。
 * - 既存 ProjectAccessService で RBAC ゲート（null=403）。
 * - 軽量に UserRepository.findById で name/avatarUrl を取得（GetCurrentUserUseCase の N+1 を避ける）。
 * - room id は backend が project:{projectId} を組み立てる（クライアントは任意スコープを送れない）。
 */
@Injectable()
export class IssueLiveblocksTokenUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly liveblocks: LiveblocksTokenService,
  ) {}

  async execute(
    input: IssueLiveblocksTokenInput,
  ): Promise<{ body: string; status: number }> {
    if (input.apiKeyId) {
      throw new ForbiddenError('API キーではプレゼンスを利用できません');
    }
    const level = await this.projectAccess.resolveProjectAccess(
      input.projectId,
      input.userId,
    );
    if (!level) {
      throw new ForbiddenError('このプロジェクトへのアクセス権がありません');
    }
    const user = await this.userRepository.findById(input.userId);
    if (!user) {
      throw new ForbiddenError('ユーザーが見つかりません');
    }
    const email = user.email;
    const name = user.name ?? email.split('@')[0];
    return this.liveblocks.mintToken({
      userId: input.userId,
      userInfo: {
        name,
        email,
        avatarUrl: user.avatarUrl,
        color: deterministicColor(input.userId),
      },
      roomId: `project:${input.projectId}`,
      fullAccess: level === 'EDIT',
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest issue-liveblocks-token`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/application/use-cases/liveblocks/
git commit -m "feat(presence): IssueLiveblocksTokenUseCase (RBAC gate + identity + mint)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: LiveblocksController + wiring (backend)

**Files:**
- Create: `backend/src/presentation/controllers/liveblocks.controller.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Write the controller**

```ts
// backend/src/presentation/controllers/liveblocks.controller.ts
import { Body, Controller, Post, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty, ApiResponse } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, CurrentUserPayload } from '../decorators/current-user.decorator';
import { IssueLiveblocksTokenUseCase } from '../../application/use-cases/liveblocks/issue-liveblocks-token.use-case';

class IssueLiveblocksTokenDto {
  @ApiProperty({ description: 'プレゼンス対象プロジェクトID' })
  @IsString()
  @IsNotEmpty()
  projectId!: string;
}

/**
 * Liveblocks プレゼンス用トークン発行エンドポイント。
 * グローバル JwtAuthGuard 配下（@Public ではない）。秘密鍵はサーバ専用。
 */
@ApiTags('リアルタイム・プレゼンス')
@ApiBearerAuth()
@Controller('liveblocks')
export class LiveblocksController {
  constructor(private readonly useCase: IssueLiveblocksTokenUseCase) {}

  @Post('token')
  @ApiOperation({ summary: 'Liveblocks プレゼンストークン発行（要 project アクセス権）' })
  @ApiResponse({ status: 403, description: 'プロジェクトアクセス権が無い / API キー呼び出し' })
  async token(
    @CurrentUser() user: CurrentUserPayload & { apiKeyId?: string },
    @Body() dto: IssueLiveblocksTokenDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const { body, status } = await this.useCase.execute({
      userId: user.id,
      apiKeyId: user.apiKeyId,
      projectId: dto.projectId,
    });
    res.status(status);
    return JSON.parse(body); // Liveblocks の body は JSON 文字列
  }
}
```

- [ ] **Step 2: Register the controller + providers in app.module**

In `backend/src/app.module.ts`:

1. Add imports near the other controller imports:
```ts
import { LiveblocksController } from './presentation/controllers/liveblocks.controller';
import { IssueLiveblocksTokenUseCase } from './application/use-cases/liveblocks/issue-liveblocks-token.use-case';
import { LiveblocksTokenService } from './infrastructure/services/liveblocks-token.service';
```
2. Add `LiveblocksController,` to the `controllers:` array (near `ProjectMyAccessController`).
3. Add `IssueLiveblocksTokenUseCase,` and `LiveblocksTokenService,` to the `providers:` array (near `ProjectAccessService,`).

(`ProjectAccessService` and the `USER_REPOSITORY` provider are already registered, so the use-case's dependencies resolve.)

- [ ] **Step 3: Verify the backend compiles and all backend tests pass**

Run: `cd backend && npm run build && npx jest`
Expected: build succeeds; jest green (existing suite + 12 new tests from Tasks 1–3).

- [ ] **Step 4: Commit**

```bash
git add backend/src/presentation/controllers/liveblocks.controller.ts backend/src/app.module.ts
git commit -m "feat(presence): POST /api/liveblocks/token controller + module wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend presence helpers + Liveblocks config

**Files:**
- Create: `frontend/src/lib/presence-helpers.ts`
- Test: `frontend/src/lib/presence-helpers.test.ts`
- Create: `frontend/src/lib/liveblocks.config.ts`
- Modify: `frontend/package.json` (add `@liveblocks/client`, `@liveblocks/react`)

- [ ] **Step 1: Install the SDKs**

Run: `cd frontend && npm install @liveblocks/client@^2 @liveblocks/react@^2`
Expected: both appear in `frontend/package.json` dependencies.

- [ ] **Step 2: Write the failing test for the pure helpers**

```ts
// frontend/src/lib/presence-helpers.test.ts
import { describe, it, expect } from 'vitest';
import {
  roomIdForProject,
  projectIdFromRoom,
  shouldShowCursor,
  dedupeByUserId,
  initialsFromName,
  displayName,
} from './presence-helpers';

describe('presence-helpers', () => {
  it('roomIdForProject / projectIdFromRoom round-trip', () => {
    expect(roomIdForProject('p1')).toBe('project:p1');
    expect(projectIdFromRoom('project:p1')).toBe('p1');
    expect(projectIdFromRoom('p1')).toBe('p1'); // tolerant if no prefix
  });

  it('shouldShowCursor: only same page AND non-null cursor', () => {
    const base = { presence: { cursor: { x: 1, y: 2 }, page: '/a' } };
    expect(shouldShowCursor(base, '/a')).toBe(true);
    expect(shouldShowCursor(base, '/b')).toBe(false);
    expect(shouldShowCursor({ presence: { cursor: null, page: '/a' } }, '/a')).toBe(false);
  });

  it('dedupeByUserId keeps first per id', () => {
    const out = dedupeByUserId([{ id: 'u1', n: 1 }, { id: 'u1', n: 2 }, { id: 'u2', n: 3 }]);
    expect(out.map((x) => x.id)).toEqual(['u1', 'u2']);
  });

  it('initialsFromName', () => {
    expect(initialsFromName('Alice Smith')).toBe('AS');
    expect(initialsFromName('Bob')).toBe('B');
    expect(initialsFromName('')).toBe('?');
  });

  it('displayName prefers name, falls back to email local-part, then "匿名"', () => {
    expect(displayName({ name: 'Alice', email: 'a@x.com' })).toBe('Alice');
    expect(displayName({ name: null, email: 'bob@x.com' })).toBe('bob');
    expect(displayName({ name: null, email: null })).toBe('匿名');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/presence-helpers.test.ts`
Expected: FAIL — cannot resolve `./presence-helpers`.

- [ ] **Step 4: Implement the helpers**

```ts
// frontend/src/lib/presence-helpers.ts
/** room id 規約。backend の `project:${projectId}` と一致させる。 */
export function roomIdForProject(projectId: string): string {
  return `project:${projectId}`;
}
export function projectIdFromRoom(room: string): string {
  return room.replace(/^project:/, '');
}

/** バックエンド presence-colors.ts のミラー（フォールバック描画用）。色の真実源は backend。 */
export const PRESENCE_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899',
] as const;

type CursorPresence = { presence: { cursor: { x: number; y: number } | null; page: string } };
/** 同一サブページかつ cursor 非 null のピアだけ描画する。 */
export function shouldShowCursor(other: CursorPresence, myPage: string): boolean {
  return !!other.presence.cursor && other.presence.page === myPage;
}

/** 同一 user.id の重複（複数タブ）を最初の1件に畳む。 */
export function dedupeByUserId<T extends { id: string }>(users: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const u of users) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    out.push(u);
  }
  return out;
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

export function displayName(info: { name?: string | null; email?: string | null }): string {
  if (info.name && info.name.trim()) return info.name.trim();
  if (info.email && info.email.includes('@')) return info.email.split('@')[0]!;
  if (info.email && info.email.trim()) return info.email.trim();
  return '匿名';
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/presence-helpers.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Implement the Liveblocks config (no test — thin wiring)**

```ts
// frontend/src/lib/liveblocks.config.ts
'use client'
import { createClient } from '@liveblocks/client'
import { createRoomContext } from '@liveblocks/react'
import { projectIdFromRoom, roomIdForProject } from './presence-helpers'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021'

export type Presence = {
  page: string
  cursor: { x: number; y: number } | null
  space: 'screen'
}
export type UserMeta = {
  id: string
  info: { name: string; email: string; avatarUrl: string | null; color: string }
}

export const liveblocksClient = createClient({
  throttle: 100,
  authEndpoint: async (room) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
    const projectId = projectIdFromRoom(room ?? '')
    const res = await fetch(`${API_URL}/api/liveblocks/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
      body: JSON.stringify({ projectId }),
    })
    if (!res.ok) throw new Error(`liveblocks auth failed: ${res.status}`)
    return res.json()
  },
})

export const {
  RoomProvider,
  useOthers,
  useSelf,
  useUpdateMyPresence,
} = createRoomContext<Presence, Record<string, never>, UserMeta>(liveblocksClient)

export { roomIdForProject }
```

- [ ] **Step 7: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/presence-helpers.ts frontend/src/lib/presence-helpers.test.ts frontend/src/lib/liveblocks.config.ts frontend/package.json frontend/package-lock.json
git commit -m "feat(presence): frontend Liveblocks config + tested presence helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Presence components (page sync, who's-online, live cursors)

**Files:**
- Create: `frontend/src/components/presence/PresencePageSync.tsx`
- Create: `frontend/src/components/presence/WhoIsOnline.tsx`
- Create: `frontend/src/components/presence/LiveCursors.tsx`

- [ ] **Step 1: PresencePageSync — push current pathname into presence**

```tsx
// frontend/src/components/presence/PresencePageSync.tsx
'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useUpdateMyPresence } from '@/lib/liveblocks.config'

/** ルート変更のたびに presence.page を更新する（カーソルの同一ページ判定に使う）。 */
export function PresencePageSync() {
  const pathname = usePathname()
  const updateMyPresence = useUpdateMyPresence()
  useEffect(() => {
    updateMyPresence({ page: pathname })
  }, [pathname, updateMyPresence])
  return null
}
```

- [ ] **Step 2: WhoIsOnline — avatar stack of everyone in the project**

```tsx
// frontend/src/components/presence/WhoIsOnline.tsx
'use client'
import { useOthers, useSelf } from '@/lib/liveblocks.config'
import { dedupeByUserId, displayName, initialsFromName } from '@/lib/presence-helpers'

type Entry = { id: string; info: { name: string; email: string; avatarUrl: string | null; color: string }; isSelf: boolean }

function Avatar({ entry }: { entry: Entry }) {
  const label = displayName(entry.info)
  return (
    <div
      title={entry.isSelf ? `${label}（あなた）` : label}
      className="relative -ml-2 h-8 w-8 overflow-hidden rounded-full border-2 bg-white text-[11px] font-semibold text-white"
      style={{ borderColor: entry.info.color }}
    >
      {entry.info.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={entry.info.avatarUrl} alt={label} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center" style={{ background: entry.info.color }}>
          {initialsFromName(label)}
        </span>
      )}
    </div>
  )
}

/** プロジェクト内でオンラインの人を重なりアバターで表示（サブページ問わず全員）。複数タブは user.id で重複排除。 */
export function WhoIsOnline() {
  const others = useOthers()
  const self = useSelf()

  const entries: Entry[] = []
  if (self) entries.push({ id: self.id ?? 'self', info: self.info, isSelf: true })
  for (const o of others) entries.push({ id: o.id ?? `c${o.connectionId}`, info: o.info, isSelf: false })
  const unique = dedupeByUserId(entries)

  if (unique.length === 0) return null
  const shown = unique.slice(0, 5)
  const overflow = unique.length - shown.length

  return (
    <div className="flex items-center rounded-full bg-white/90 px-2 py-1 shadow-sm ring-1 ring-gray-200">
      <div className="flex items-center pl-2">
        {shown.map((e) => (
          <Avatar key={e.id} entry={e} />
        ))}
      </div>
      {overflow > 0 && (
        <span className="ml-1 text-xs font-medium text-gray-500">+{overflow}</span>
      )}
    </div>
  )
}
```

- [ ] **Step 3: LiveCursors — capture my cursor, render same-page peers**

```tsx
// frontend/src/components/presence/LiveCursors.tsx
'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useOthers, useUpdateMyPresence } from '@/lib/liveblocks.config'
import { displayName, shouldShowCursor } from '@/lib/presence-helpers'

function CursorSvg({ color }: { color: string }) {
  return (
    <svg width="18" height="24" viewBox="0 0 18 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1 1L1 17.5L5.5 13.5L8.5 20L11 19L8 12.5L14 12.5L1 1Z" fill={color} stroke="white" strokeWidth="1.2" />
    </svg>
  )
}

/**
 * 全画面の固定オーバーレイ。pointermove で自分の cursor（viewport 座標）を更新し、
 * 同一サブページのピアのカーソルを描画する。Liveblocks client が throttle(100ms) で送信を間引く。
 */
export function LiveCursors() {
  const others = useOthers()
  const updateMyPresence = useUpdateMyPresence()
  const pathname = usePathname()

  useEffect(() => {
    const onMove = (e: PointerEvent) => updateMyPresence({ cursor: { x: e.clientX, y: e.clientY } })
    const onLeave = () => updateMyPresence({ cursor: null })
    window.addEventListener('pointermove', onMove)
    document.addEventListener('pointerleave', onLeave)
    window.addEventListener('blur', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onLeave)
    }
  }, [updateMyPresence])

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      {others.map((o) => {
        if (!shouldShowCursor(o, pathname) || !o.presence.cursor) return null
        const { x, y } = o.presence.cursor
        return (
          <div key={o.connectionId} className="absolute" style={{ left: x, top: y, transform: 'translate(-2px, -2px)' }}>
            <CursorSvg color={o.info.color} />
            <span
              className="ml-3 inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
              style={{ background: o.info.color }}
            >
              {displayName(o.info)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/presence/
git commit -m "feat(presence): WhoIsOnline + LiveCursors + PresencePageSync components

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Mount presence in the project layout

**Files:**
- Modify: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/layout.tsx`

- [ ] **Step 1: Replace the layout with the room-wrapped version**

```tsx
// frontend/src/app/(dashboard)/dashboard/projects/[projectId]/layout.tsx
'use client'

import { useParams, usePathname } from 'next/navigation'
import { ClientSideSuspense } from '@liveblocks/react'
import { useProjectAccess } from '@/hooks/use-project-access'
import { ReadOnlyProvider, ReadOnlyBanner } from '@/components/read-only-context'
import { RoomProvider, roomIdForProject } from '@/lib/liveblocks.config'
import { WhoIsOnline } from '@/components/presence/WhoIsOnline'
import { LiveCursors } from '@/components/presence/LiveCursors'
import { PresencePageSync } from '@/components/presence/PresencePageSync'

/**
 * プロジェクト配下（/dashboard/projects/[projectId]/...）共通レイアウト。
 *
 * - my-access から実効権限を取得し ReadOnlyContext で配下に供給する（閲覧専用バナー）。
 * - Liveblocks RoomProvider（room=project:{projectId}）で全サブページにプレゼンスを付与。
 *   オンライン表示（WhoIsOnline）とライブカーソル（LiveCursors）を1回だけ設置する。
 *   トークン取得に失敗（秘密鍵未設定/401）してもページは通常表示される（グレースフルデグレード）。
 */
export default function ProjectScopedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const params = useParams()
  const projectId = (params?.projectId as string) ?? null
  const pathname = usePathname()
  const { level, canEdit, loading } = useProjectAccess(projectId)

  const body = (
    <>
      <ReadOnlyBanner />
      {children}
    </>
  )

  if (!projectId) {
    return <ReadOnlyProvider value={{ canEdit, level, loading }}>{body}</ReadOnlyProvider>
  }

  return (
    <ReadOnlyProvider value={{ canEdit, level, loading }}>
      <RoomProvider
        id={roomIdForProject(projectId)}
        initialPresence={{ page: pathname, cursor: null, space: 'screen' }}
      >
        <ClientSideSuspense fallback={null}>
          {() => (
            <>
              <div className="fixed right-4 top-16 z-40">
                <WhoIsOnline />
              </div>
              <PresencePageSync />
              <LiveCursors />
            </>
          )}
        </ClientSideSuspense>
        {body}
      </RoomProvider>
    </ReadOnlyProvider>
  )
}
```

- [ ] **Step 2: Typecheck, full frontend test suite, and build**

Run: `cd frontend && npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc 0 errors; vitest all green (existing 195 + 5 new helper tests = 200); `next build` succeeds, `/dashboard/projects/[projectId]` compiles.

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/(dashboard)/dashboard/projects/[projectId]/layout.tsx"
git commit -m "feat(presence): mount RoomProvider + who's-online + live cursors in project layout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Env, secret-leak guard, and docs

**Files:**
- Modify: `backend/.env.example` (only if it exists)
- Modify: `frontend/package.json` (add `check:secrets` script)

- [ ] **Step 1: Document the backend secret**

If `backend/.env.example` exists, append:
```
# Liveblocks (リアルタイム・プレゼンス) — サーバ専用秘密鍵。未設定でもプレゼンスが出ないだけ。
LIVEBLOCKS_SECRET_KEY=
```
If it does not exist, skip the file change (the var is documented in the spec and §below).

- [ ] **Step 2: Add a frontend secret-leak guard script**

In `frontend/package.json` `scripts`, add:
```json
"check:secrets": "if grep -rEn 'sk_[A-Za-z0-9_]{8,}|LIVEBLOCKS_SECRET' src; then echo 'ERROR: Liveblocks secret reference found in frontend/src' && exit 1; else echo 'OK: no Liveblocks secret in frontend/src'; fi"
```

- [ ] **Step 3: Run the guard to confirm it passes (no secret in frontend)**

Run: `cd frontend && npm run check:secrets`
Expected: prints `OK: no Liveblocks secret in frontend/src` (exit 0). The frontend only ever reads `localStorage.accessToken` and `NEXT_PUBLIC_API_URL`.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json backend/.env.example 2>/dev/null; git add frontend/package.json
git commit -m "chore(presence): document LIVEBLOCKS_SECRET_KEY + frontend secret-leak guard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Post-implementation: manual verification & deploy (requires user action)

These are NOT code steps; do them after the tasks above and report results.

**Set the secret (user-owned):**
- Create a Liveblocks account/project, copy the secret key (`sk_...`).
- Set `LIVEBLOCKS_SECRET_KEY` on the backend env for every environment used:
  `cd backend && vercel env add LIVEBLOCKS_SECRET_KEY production --value "$KEY" --sensitive --force --yes` (repeat for preview/development), or set locally in `backend/.env` for dev.

**Live multi-client smoke (two browsers / two accounts on the same project):**
- Both users appear in the avatar stack regardless of sub-page.
- On the SAME sub-page, each sees the other's cursor (correct color + name), tracking the pointer.
- On DIFFERENT sub-pages, cursors are hidden but both remain in the avatar stack.
- Navigate sub-pages → no reconnect flicker; switch projects → avatar stack swaps.
- Close a tab / move pointer off-window → that cursor disappears.
- DevTools Network: the browser bundle contains no `sk_` value; the `authEndpoint` POST carries the `accessToken` Bearer; with the secret unset the pages still render (presence simply absent).

**Deploy (only with explicit user approval, per project gate):** frontend-changes + backend-changes → PR `feat/methodology-pipeline` → main → deploy backend (`brain-pro-api`) and frontend (`brain-pro.iplot.jp`). The schema is unchanged (no `prisma db push` concerns).

---

## Self-Review

**Spec coverage:**
- §2 token endpoint → Tasks 2–4. §2.3 reject API keys / RBAC null→403 / lean findById / name fallback / color / roomId / READ vs FULL / return raw body → Task 3 tests + Task 4 controller. §3 room-per-project → Task 5 `roomIdForProject` + Task 7 `RoomProvider`. §4 presence shape + viewport cursors + same-page filter + dedupe + throttle → Tasks 5–6. §5 client config + mount in project layout + SSR (`ClientSideSuspense`, `'use client'`) → Tasks 5–7. §6 one overlay covers all project pages → Task 7. §7 env + no `NEXT_PUBLIC` secret + grep guard → Task 8. §8 unit + build coverage → Tasks 1–7 tests; live smoke → Post-implementation. §9 graceful degradation → Task 2 throw + Task 5 authEndpoint throw + Task 7 comment/`fallback={null}`.
- Out-of-scope (CRDT/editing/canvas-world cursors) correctly excluded; `space: 'screen'` discriminator reserved (Task 5 type).

**Placeholder scan:** none — every code step contains full code; no TBD/"handle errors"/"similar to".

**Type consistency:** `mintToken({ userId, userInfo:{name,email,avatarUrl,color}, roomId, fullAccess })` identical across Task 2 (impl), Task 3 (caller + test assertions). `Presence = { page, cursor, space }` and `UserMeta.info = { name,email,avatarUrl,color }` identical across Tasks 5/6/7. `roomIdForProject` defined Task 5, used Task 7. `shouldShowCursor`/`dedupeByUserId`/`displayName`/`initialsFromName` defined Task 5, used Task 6. Controller reads `user.apiKeyId` via `CurrentUserPayload & { apiKeyId?: string }` (runtime-present per `jwt-auth.guard.ts`).
