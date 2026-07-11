# ipro-bot AIゲートウェイ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brain Pro のAI呼び出し（9機能）を、組織設定で ipro-bot の新設 `POST /api/ai/run` ゲートウェイ経由に切り替え可能にする（IPLoT頭脳注入＋会社別AI予算ガード＋自動フォールバック付き）。

**Architecture:** Brain Pro 側は `ClaudeService` 内部に `LlmTransport` 抽象（AnthropicTransport / IproBotTransport）と `IproBotGatewayService`（組織→接続設定の解決）を導入し、9メソッドの `client.messages.create` を共通ヘルパ `runLlm` に置換する。ipro-bot 側は directory-tokens と同型の `ai_gateway_tokens` 認証で `/api/ai/run`・`/api/ai/health` を新設し、taskType→method.md の頭脳注入と `enforceAiBudget`・`recordModelUsage` を通す。

**Tech Stack:** Brain Pro backend = NestJS + Prisma + jest（specはソース隣接・plain `new`＋`jest.fn()`モック）。ipro-bot = Next.js App Router + Drizzle/Neon + vitest（`vi.mock`＋`vi.hoisted`、ネットワーク不要）。Spec: `docs/superpowers/specs/2026-07-11-ipro-bot-ai-gateway-design.md`

## Global Constraints

- 新しい npm 依存は両リポジトリとも追加しない
- ipro-bot のトークンは `aig_` + base64url(32byte)、保存は SHA-256 hex ハッシュのみ・平文は発行時に1回だけ表示
- Brain Pro の秘密情報は `CryptoService`（AES-256-GCM、env `TOKEN_ENC_KEY`）で暗号化し、APIレスポンスには `hasApiToken: boolean` のみ返す（値は返さない）
- Brain Pro の env フォールバック名: `IPRO_BOT_URL` / `IPRO_BOT_API_TOKEN`。env 読みは `process.env.X` 直読み（ConfigService不使用）
- `ClaudeService` の9公開メソッドのシグネチャ・戻り値・JSONパース挙動は不変（呼び出し元は無改修）
- マルチモーダル（document/image ブロック入り）リクエストは連携ONでもゲートウェイを通さず直接 Anthropic（Vercelボディ上限4.5MB対策）
- フォールバック規則: gateway 401 → フォールバックせず throw / `strict=true` → throw / それ以外の失敗 → 直接Anthropicで再実行＋warnログ
- ゲートウェイは Brain Pro が指定した model 文字列をそのまま使う（`isSelectableModel` で弾かない。dated model ID `claude-haiku-4-5-20251001` を通すため）。model 未指定時のみ `resolveDefaultModel()`
- 頭脳注入は method.md のみ（IPROくんの persona は注入しない — Brain Pro の「JSONのみ出力」指示を壊さないため）。system ブロック順は [method(cache_control 1h), Brain Pro system] で Brain Pro 側が後勝ち
- ipro-bot ルートは `export const runtime = "nodejs"` 必須、UIテキスト・コメントは日本語、既存ファイルのコメント密度に合わせる
- Prisma スキーマ適用（Brain Pro ローカル）は `npx prisma db push`（`migrate dev` は shadow DB で失敗する既知問題）。ipro-bot は番号付きSQL + `node --env-file=.env.local scripts/migrate.mjs`
- コミットは各タスク末尾で必ず行う。ipro-bot リポジトリのタスクは `/Users/kazuyukijimbo/ipro-bot` で、Brain Pro のタスクは `/Users/kazuyukijimbo/ai-data-flow` でコミットする

---

# Part A: ipro-bot 側（ゲートウェイ本体）

### Task 1: ai_gateway_tokens テーブル＋DBヘルパ

**Files:**
- Modify: `/Users/kazuyukijimbo/ipro-bot/src/db/schema.ts`（directoryTokens 定義の直後に追加）
- Create: `/Users/kazuyukijimbo/ipro-bot/migrations/0034_ai_gateway_tokens.sql`（既存最大は 0033_line_room_members.sql — 着手時に `ls migrations/ | sort | tail -1` で最新番号を確認し、埋まっていれば次番号に振り直す）
- Create: `/Users/kazuyukijimbo/ipro-bot/src/db/ai-gateway-tokens.ts`

**Interfaces:**
- Produces: `issueAiGatewayToken(inp: {companyId, tokenHash, prefix, label?, createdBy?}): Promise<number>`、`findActiveAiGatewayTokenByHash(tokenHash: string): Promise<{id: number; companyId: string} | null>`、`touchAiGatewayTokenLastUsed(id: number): Promise<void>`、`listAiGatewayTokens(companyId)`、`revokeAiGatewayToken(id, companyId)` — Task 2/5 が使う

- [ ] **Step 1: schema.ts にテーブル定義を追加**

`src/db/schema.ts` の `directoryTokens` ブロック（L101-122）の直後に:

```ts
// Brain Pro 等の外部システム向けAIゲートウェイ(/api/ai/*)のアクセストークン。
// 会社スコープのみ。平文は保存せず token_hash(SHA-256) のみ。
export const aiGatewayTokens = pgTable(
  "ai_gateway_tokens",
  {
    id: serial("id").primaryKey(),
    companyId: text("company_id").notNull(), // テナント境界
    tokenHash: text("token_hash").notNull(), // SHA-256(hex)。検索キー
    prefix: text("prefix").notNull(), // 表示用 aig_xxxxxxxx（先頭12字）
    label: text("label"),
    createdBy: integer("created_by"), // 発行した users.id
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"), // null=有効
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    hashIdx: index("ai_gateway_tokens_hash_idx").on(t.tokenHash),
    companyIdx: index("ai_gateway_tokens_company_idx").on(t.companyId, t.createdAt),
  }),
);
```

- [ ] **Step 2: マイグレーションSQLを作成**

`migrations/0034_ai_gateway_tokens.sql`（冪等・neon-http対応のため関数内 `;` なし）:

```sql
create table if not exists ai_gateway_tokens (
  id serial primary key,
  company_id text not null,
  token_hash text not null,
  prefix text not null,
  label text,
  created_by integer,
  last_used_at timestamp,
  revoked_at timestamp,
  created_at timestamp not null default now()
);
create index if not exists ai_gateway_tokens_hash_idx on ai_gateway_tokens (token_hash);
create index if not exists ai_gateway_tokens_company_idx on ai_gateway_tokens (company_id, created_at);
```

- [ ] **Step 3: DBヘルパを作成**

`src/db/ai-gateway-tokens.ts`（`src/db/directory-tokens.ts` と同型）:

```ts
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "./index";
import { aiGatewayTokens } from "./schema";

export interface IssueAiGatewayTokenInput {
  companyId: string;
  tokenHash: string;
  prefix: string;
  label?: string | null;
  createdBy?: number | null;
}

/** AIゲートウェイトークンを1件発行（ハッシュ/prefix のみ保存）。returning の id を返す。 */
export async function issueAiGatewayToken(inp: IssueAiGatewayTokenInput): Promise<number> {
  const [row] = await db
    .insert(aiGatewayTokens)
    .values({
      companyId: inp.companyId,
      tokenHash: inp.tokenHash,
      prefix: inp.prefix,
      label: inp.label ?? null,
      createdBy: inp.createdBy ?? null,
    })
    .returning({ id: aiGatewayTokens.id });
  return row.id;
}

export interface ActiveAiGatewayToken {
  id: number;
  companyId: string;
}

/** 有効（未失効）なトークンをハッシュで照合。無ければ null。 */
export async function findActiveAiGatewayTokenByHash(
  tokenHash: string,
): Promise<ActiveAiGatewayToken | null> {
  const rows = await db
    .select({ id: aiGatewayTokens.id, companyId: aiGatewayTokens.companyId })
    .from(aiGatewayTokens)
    .where(and(eq(aiGatewayTokens.tokenHash, tokenHash), isNull(aiGatewayTokens.revokedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/** 最終利用時刻を更新（監査用・失敗は握り潰す）。 */
export async function touchAiGatewayTokenLastUsed(id: number): Promise<void> {
  try {
    await db.update(aiGatewayTokens).set({ lastUsedAt: new Date() }).where(eq(aiGatewayTokens.id, id));
  } catch {
    /* noop */
  }
}

/** 会社のトークン一覧（新しい順）。 */
export async function listAiGatewayTokens(companyId: string) {
  return db
    .select()
    .from(aiGatewayTokens)
    .where(eq(aiGatewayTokens.companyId, companyId))
    .orderBy(desc(aiGatewayTokens.createdAt));
}

/** トークンを失効（自社のもののみ）。 */
export async function revokeAiGatewayToken(id: number, companyId: string): Promise<void> {
  await db
    .update(aiGatewayTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(aiGatewayTokens.id, id), eq(aiGatewayTokens.companyId, companyId)));
}
```

- [ ] **Step 4: 型チェックとマイグレーション適用**

Run: `cd /Users/kazuyukijimbo/ipro-bot && npx tsc --noEmit`
Expected: エラーなし

Run: `cd /Users/kazuyukijimbo/ipro-bot && node --env-file=.env.local scripts/migrate.mjs`
Expected: `0034_ai_gateway_tokens.sql` が applied と出力される（`.env.local` が無い環境ではこのステップをスキップし、コミットメッセージに「migrate未適用」と書く）

- [ ] **Step 5: Commit**

```bash
cd /Users/kazuyukijimbo/ipro-bot
git add src/db/schema.ts src/db/ai-gateway-tokens.ts migrations/0034_ai_gateway_tokens.sql
git commit -m "feat(ai-gateway): ai_gateway_tokens テーブルとDBヘルパを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2: トークン認証モジュール（ai-gateway-auth）

**Files:**
- Create: `/Users/kazuyukijimbo/ipro-bot/src/lib/ai-gateway-auth.ts`
- Test: `/Users/kazuyukijimbo/ipro-bot/src/lib/ai-gateway-auth.test.ts`

**Interfaces:**
- Consumes: Task 1 の `findActiveAiGatewayTokenByHash` / `touchAiGatewayTokenLastUsed`、既存 `hashToken`（`src/lib/directory-auth.ts`）
- Produces: `generateAiGatewayToken(): { plaintext: string; tokenHash: string; prefix: string }`、`resolveAiGatewayToken(authHeader: string | null): Promise<AiGatewayScope | null>`、`interface AiGatewayScope { tokenId: number; companyId: string }` — Task 4/5 が使う

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/ai-gateway-auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { findActiveAiGatewayTokenByHash, touchAiGatewayTokenLastUsed } = vi.hoisted(() => ({
  findActiveAiGatewayTokenByHash: vi.fn(async (..._a: unknown[]): Promise<unknown> => null),
  touchAiGatewayTokenLastUsed: vi.fn(async () => {}),
}));
vi.mock("../db/ai-gateway-tokens", () => ({
  findActiveAiGatewayTokenByHash,
  touchAiGatewayTokenLastUsed,
}));

import { generateAiGatewayToken, resolveAiGatewayToken } from "./ai-gateway-auth";
import { hashToken } from "./directory-auth";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateAiGatewayToken", () => {
  it("aig_ プレフィクスの平文と sha256 ハッシュ・先頭12字 prefix を返す", () => {
    const t = generateAiGatewayToken();
    expect(t.plaintext.startsWith("aig_")).toBe(true);
    expect(t.tokenHash).toBe(hashToken(t.plaintext));
    expect(t.prefix).toBe(t.plaintext.slice(0, 12));
  });
});

describe("resolveAiGatewayToken", () => {
  it("Authorization ヘッダ無しは null", async () => {
    expect(await resolveAiGatewayToken(null)).toBeNull();
    expect(findActiveAiGatewayTokenByHash).not.toHaveBeenCalled();
  });

  it("Bearer 形式でないヘッダは null", async () => {
    expect(await resolveAiGatewayToken("Basic abc")).toBeNull();
  });

  it("有効トークンは companyId スコープを返し lastUsed を touch する", async () => {
    findActiveAiGatewayTokenByHash.mockResolvedValueOnce({ id: 7, companyId: "c1" });
    const scope = await resolveAiGatewayToken("Bearer aig_dummy");
    expect(scope).toEqual({ tokenId: 7, companyId: "c1" });
    expect(findActiveAiGatewayTokenByHash).toHaveBeenCalledWith(hashToken("aig_dummy"));
    expect(touchAiGatewayTokenLastUsed).toHaveBeenCalledWith(7);
  });

  it("DBに無い/失効済みトークンは null", async () => {
    findActiveAiGatewayTokenByHash.mockResolvedValueOnce(null);
    expect(await resolveAiGatewayToken("Bearer aig_bad")).toBeNull();
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `cd /Users/kazuyukijimbo/ipro-bot && npx vitest run src/lib/ai-gateway-auth.test.ts`
Expected: FAIL（`./ai-gateway-auth` が存在しない）

- [ ] **Step 3: 実装を書く**

`src/lib/ai-gateway-auth.ts`:

```ts
import { randomBytes } from "node:crypto";
import { hashToken } from "./directory-auth";
import {
  findActiveAiGatewayTokenByHash,
  touchAiGatewayTokenLastUsed,
} from "../db/ai-gateway-tokens";

export interface AiGatewayScope {
  tokenId: number;
  companyId: string;
}

/** 新規AIゲートウェイトークンを生成。平文は呼び出し側で1回だけ表示し、保存しない。 */
export function generateAiGatewayToken(): {
  plaintext: string;
  tokenHash: string;
  prefix: string;
} {
  const plaintext = `aig_${randomBytes(32).toString("base64url")}`;
  return { plaintext, tokenHash: hashToken(plaintext), prefix: plaintext.slice(0, 12) };
}

function extractBearer(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1].trim() : null;
}

/** Authorization から会社スコープを解決。無効/失効/未指定は null。 */
export async function resolveAiGatewayToken(
  authHeader: string | null,
): Promise<AiGatewayScope | null> {
  const token = extractBearer(authHeader);
  if (!token) return null;
  const hit = await findActiveAiGatewayTokenByHash(hashToken(token));
  if (!hit) return null;
  void touchAiGatewayTokenLastUsed(hit.id); // fire-and-forget（監査）
  return { tokenId: hit.id, companyId: hit.companyId };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd /Users/kazuyukijimbo/ipro-bot && npx vitest run src/lib/ai-gateway-auth.test.ts`
Expected: PASS（5テスト）

- [ ] **Step 5: Commit**

```bash
cd /Users/kazuyukijimbo/ipro-bot
git add src/lib/ai-gateway-auth.ts src/lib/ai-gateway-auth.test.ts
git commit -m "feat(ai-gateway): aig_ トークンの生成と Bearer 認証リゾルバを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 3: ゲートウェイ実行コア（ai-gateway core）

**Files:**
- Create: `/Users/kazuyukijimbo/ipro-bot/src/core/ai-gateway.ts`
- Test: `/Users/kazuyukijimbo/ipro-bot/src/core/ai-gateway.test.ts`

**Interfaces:**
- Consumes: `loadMethod(intent)`（`src/core/methodology.ts`）、`resolveDefaultModel()`（`src/core/claude.ts`）、`recordModelUsage(model, purpose, usage)`（`src/db/model-usage.ts`）
- Produces: `parseAiRunBody(body: unknown): AiRunInput | { error: string }`、`runAiGateway(input: AiRunInput): Promise<AiRunResult>`、型 `AiRunInput { taskType: string; model?: string; system?: string; messages: MessageParam[]; maxTokens?: number; projectRef?: {...} }`、`AiRunResult { text: string; model: string; usage: { inputTokens; outputTokens; cacheCreationInputTokens; cacheReadInputTokens } }` — Task 4 のルートが使う

- [ ] **Step 1: 失敗するテストを書く**

`src/core/ai-gateway.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { create } = vi.hoisted(() => ({
  create: vi.fn(async (..._args: unknown[]) => ({
    content: [{ type: "text", text: '{"ok":true}' }],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 10,
      cache_creation_input_tokens: 5,
    },
  })),
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

const { recordModelUsage } = vi.hoisted(() => ({ recordModelUsage: vi.fn(async () => {}) }));
vi.mock("../db/model-usage", () => ({ recordModelUsage }));

const { loadMethod } = vi.hoisted(() => ({
  loadMethod: vi.fn((intent: string) => ({ method: `METHOD:${intent}`, persona: "PERSONA" })),
}));
vi.mock("./methodology", () => ({ loadMethod }));

vi.mock("./claude", () => ({ resolveDefaultModel: async () => "claude-opus-4-8" }));

import { parseAiRunBody, runAiGateway } from "./ai-gateway";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseAiRunBody", () => {
  it("taskType と messages が必須", () => {
    expect(parseAiRunBody({})).toEqual({ error: "taskType が必要です" });
    expect(parseAiRunBody({ taskType: "KPI" })).toEqual({ error: "messages が必要です" });
    expect(parseAiRunBody({ taskType: "KPI", messages: [] })).toEqual({
      error: "messages が必要です",
    });
  });

  it("正常系は入力をそのまま返す", () => {
    const body = { taskType: "KPI", messages: [{ role: "user", content: "hi" }], system: "S" };
    expect(parseAiRunBody(body)).toMatchObject({ taskType: "KPI", system: "S" });
  });
});

describe("runAiGateway", () => {
  it("マップにある taskType は method.md を cache_control 付き先頭 system ブロックとして注入する", async () => {
    await runAiGateway({
      taskType: "REQUIREMENT",
      system: "BRAIN_PRO_SYSTEM",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(loadMethod).toHaveBeenCalledWith("requirements");
    const arg = create.mock.calls[0][0] as Record<string, any>;
    expect(arg.system).toEqual([
      {
        type: "text",
        text: "METHOD:requirements",
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
      { type: "text", text: "BRAIN_PRO_SYSTEM" },
    ]);
  });

  it("マップに無い taskType は素通し（Brain Pro の system のみ）", async () => {
    await runAiGateway({
      taskType: "MERMAID_FLOW",
      system: "S",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(loadMethod).not.toHaveBeenCalled();
    const arg = create.mock.calls[0][0] as Record<string, any>;
    expect(arg.system).toEqual([{ type: "text", text: "S" }]);
  });

  it("model 指定はそのまま使い、未指定は resolveDefaultModel", async () => {
    await runAiGateway({
      taskType: "OTHER",
      model: "claude-haiku-4-5-20251001",
      messages: [{ role: "user", content: "hi" }],
    });
    expect((create.mock.calls[0][0] as any).model).toBe("claude-haiku-4-5-20251001");

    await runAiGateway({ taskType: "OTHER", messages: [{ role: "user", content: "hi" }] });
    expect((create.mock.calls[1][0] as any).model).toBe("claude-opus-4-8");
  });

  it("usage を brain-pro:<taskType> の purpose で記録し、camelCase usage を返す", async () => {
    const res = await runAiGateway({
      taskType: "KPI",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(recordModelUsage).toHaveBeenCalledWith(
      "claude-opus-4-8",
      "brain-pro:KPI",
      expect.objectContaining({ input_tokens: 100 }),
    );
    expect(res).toEqual({
      text: '{"ok":true}',
      model: "claude-opus-4-8",
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 10,
        cacheCreationInputTokens: 5,
      },
    });
  });

  it("system 未指定かつマップ無しなら system を渡さない（空配列で400を踏まない）", async () => {
    await runAiGateway({ taskType: "OTHER", messages: [{ role: "user", content: "hi" }] });
    const arg = create.mock.calls[0][0] as Record<string, any>;
    expect("system" in arg).toBe(false);
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `cd /Users/kazuyukijimbo/ipro-bot && npx vitest run src/core/ai-gateway.test.ts`
Expected: FAIL（`./ai-gateway` が存在しない）

- [ ] **Step 3: 実装を書く**

`src/core/ai-gateway.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { loadMethod } from "./methodology";
import { resolveDefaultModel } from "./claude";
import { recordModelUsage } from "../db/model-usage";
import type { Intent } from "./types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Brain Pro の LlmUsageArea → IPLoT頭脳(method.md)の対応。無い taskType は素通し。
// persona は注入しない（Brain Pro 側の「JSONのみ出力」指示を壊さないため method のみ）。
const TASK_METHOD: Record<string, Intent> = {
  REQUIREMENT: "requirements",
  ISSUE_SUGGEST: "issue-tree",
  KPI: "analysis",
  KNOWLEDGE_EXTRACTION: "current-state",
};

export interface AiRunInput {
  taskType: string;
  model?: string;
  system?: string;
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
  projectRef?: { adfOrganizationId?: string; adfProjectId?: string };
}

export interface AiRunResult {
  text: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
}

/** リクエストボディの最小バリデーション。失敗は { error } を返す（throw しない）。 */
export function parseAiRunBody(body: unknown): AiRunInput | { error: string } {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b.taskType !== "string" || !b.taskType) {
    return { error: "taskType が必要です" };
  }
  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    return { error: "messages が必要です" };
  }
  return {
    taskType: b.taskType,
    model: typeof b.model === "string" && b.model ? b.model : undefined,
    system: typeof b.system === "string" && b.system ? b.system : undefined,
    messages: b.messages as Anthropic.MessageParam[],
    maxTokens: typeof b.maxTokens === "number" ? b.maxTokens : undefined,
    projectRef:
      b.projectRef && typeof b.projectRef === "object"
        ? (b.projectRef as AiRunInput["projectRef"])
        : undefined,
  };
}

/**
 * Brain Pro からの1呼び出しを実行する。頭脳注入 → Claude 実行 → usage 記録。
 * model は呼び出し元指定をそのまま使う（dated ID も通す）。未指定時のみ既定解決。
 */
export async function runAiGateway(input: AiRunInput): Promise<AiRunResult> {
  const model = input.model || (await resolveDefaultModel());

  const system: Anthropic.MessageCreateParams["system"] = [];
  const intent = TASK_METHOD[input.taskType];
  if (intent) {
    const { method } = loadMethod(intent);
    if (method.trim()) {
      system.push({
        type: "text" as const,
        text: method,
        cache_control: { type: "ephemeral" as const, ttl: "1h" as const },
      });
    }
  }
  if (input.system?.trim()) {
    system.push({ type: "text" as const, text: input.system });
  }

  const msg = await client.messages.create({
    model,
    max_tokens: input.maxTokens ?? 8192,
    ...(system.length > 0 ? { system } : {}),
    messages: input.messages,
  });

  await recordModelUsage(model, `brain-pro:${input.taskType}`, msg.usage);

  const text = msg.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("");

  return {
    text,
    model,
    usage: {
      inputTokens: msg.usage?.input_tokens ?? 0,
      outputTokens: msg.usage?.output_tokens ?? 0,
      cacheReadInputTokens: msg.usage?.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: msg.usage?.cache_creation_input_tokens ?? 0,
    },
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd /Users/kazuyukijimbo/ipro-bot && npx vitest run src/core/ai-gateway.test.ts`
Expected: PASS（8テスト）

- [ ] **Step 5: Commit**

```bash
cd /Users/kazuyukijimbo/ipro-bot
git add src/core/ai-gateway.ts src/core/ai-gateway.test.ts
git commit -m "feat(ai-gateway): 頭脳注入つきゲートウェイ実行コアを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 4: /api/ai/run と /api/ai/health ルート

**Files:**
- Create: `/Users/kazuyukijimbo/ipro-bot/app/api/ai/run/route.ts`
- Create: `/Users/kazuyukijimbo/ipro-bot/app/api/ai/health/route.ts`
- Modify: `/Users/kazuyukijimbo/ipro-bot/vercel.json`（functions に maxDuration 追加）

**Interfaces:**
- Consumes: Task 2 `resolveAiGatewayToken`、Task 3 `parseAiRunBody`/`runAiGateway`、既存 `enforceAiBudget`（`src/lib/ai-budget.ts`）、`withCompanyUsage`（`src/core/usage-context.ts`）
- Produces: HTTP API。`POST /api/ai/run` → 200 `{ text, model, usage }` / 401 / 400 `{error}` / 429 `{error:"budget_exceeded", costUsd, budgetUsd}` / 502 `{error:"anthropic_error", message}`。`GET /api/ai/health` → 200 `{ ok: true, companyId }` / 401 — Brain Pro の Task 7/10 が呼ぶ

（注: ルートは `app/` 配下のため vitest の include 対象外。ロジックは Task 2/3 でテスト済みなのでルートは薄い配線のみとし、ビルドで検証する）

- [ ] **Step 1: run ルートを書く**

`app/api/ai/run/route.ts`:

```ts
import { resolveAiGatewayToken } from "@/lib/ai-gateway-auth";
import { enforceAiBudget } from "@/lib/ai-budget";
import { withCompanyUsage } from "@/core/usage-context";
import { parseAiRunBody, runAiGateway } from "@/core/ai-gateway";

// Brain Pro 向けAIゲートウェイ。Bearer(aig_) 認証 → 予算ガード → 頭脳注入つき実行。
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request): Promise<Response> {
  const scope = await resolveAiGatewayToken(req.headers.get("authorization"));
  if (!scope) return new Response("unauthorized", { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = parseAiRunBody(body);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  return withCompanyUsage(scope.companyId, async () => {
    const verdict = await enforceAiBudget(scope.companyId);
    if (verdict.exceeded) {
      return Response.json(
        { error: "budget_exceeded", costUsd: verdict.costUsd, budgetUsd: verdict.budgetUsd },
        { status: 429 },
      );
    }
    try {
      const result = await runAiGateway(parsed);
      return Response.json(result);
    } catch (e) {
      // Anthropic 側の失敗は 502 に正規化（Brain Pro のログで原因追跡できるよう message を含める）
      return Response.json(
        { error: "anthropic_error", message: e instanceof Error ? e.message : String(e) },
        { status: 502 },
      );
    }
  });
}
```

- [ ] **Step 2: health ルートを書く**

`app/api/ai/health/route.ts`:

```ts
import { resolveAiGatewayToken } from "@/lib/ai-gateway-auth";

// Brain Pro 管理UIの「接続テスト」用。トークンの有効性だけを検証する。
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const scope = await resolveAiGatewayToken(req.headers.get("authorization"));
  if (!scope) return new Response("unauthorized", { status: 401 });
  return Response.json({ ok: true, companyId: scope.companyId });
}
```

- [ ] **Step 3: vercel.json に maxDuration を追加**

`vercel.json` の `functions` オブジェクトに既存エントリと同じ形式で追加（既存の `app/api/slack/events/route.ts` エントリの隣）:

```json
"app/api/ai/run/route.ts": { "maxDuration": 300 }
```

- [ ] **Step 4: 全体テストとビルドで検証**

Run: `cd /Users/kazuyukijimbo/ipro-bot && npm test`
Expected: 全green（既存＋新規）

Run: `cd /Users/kazuyukijimbo/ipro-bot && npm run build`
Expected: next build 成功（`/api/ai/run`・`/api/ai/health` がルート一覧に出る）

- [ ] **Step 5: Commit**

```bash
cd /Users/kazuyukijimbo/ipro-bot
git add app/api/ai/run/route.ts app/api/ai/health/route.ts vercel.json
git commit -m "feat(ai-gateway): /api/ai/run と /api/ai/health ルートを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 5: トークン発行スクリプト

**Files:**
- Create: `/Users/kazuyukijimbo/ipro-bot/scripts/issue-ai-gateway-token.mjs`

**Interfaces:**
- Consumes: Task 1 のテーブル（raw SQL で insert。TSモジュールを .mjs から import しないため）
- Produces: CLI。`node --env-file=.env.local scripts/issue-ai-gateway-token.mjs <companyId> [label]` → 平文トークンを1回だけ標準出力に表示

- [ ] **Step 1: 既存スクリプトのDBクライアントを確認**

Run: `head -20 /Users/kazuyukijimbo/ipro-bot/scripts/migrate.mjs`
Expected: `@neondatabase/serverless` の `neon` を使う import が見える（違うクライアントならそれに合わせて Step 2 の import を差し替える）

- [ ] **Step 2: スクリプトを書く**

`scripts/issue-ai-gateway-token.mjs`:

```js
// AIゲートウェイトークン(aig_)の発行。平文はこの出力でのみ表示され、DBにはハッシュのみ保存される。
// 使い方: node --env-file=.env.local scripts/issue-ai-gateway-token.mjs <companyId> [label]
import { randomBytes, createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const [companyId, label] = process.argv.slice(2);
if (!companyId) {
  console.error("使い方: node --env-file=.env.local scripts/issue-ai-gateway-token.mjs <companyId> [label]");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL が未設定です（--env-file を指定してください）");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const plaintext = `aig_${randomBytes(32).toString("base64url")}`;
const tokenHash = createHash("sha256").update(plaintext).digest("hex");
const prefix = plaintext.slice(0, 12);

await sql`
  insert into ai_gateway_tokens (company_id, token_hash, prefix, label)
  values (${companyId}, ${tokenHash}, ${prefix}, ${label ?? null})
`;

console.log("発行しました（このトークンは一度だけ表示されます）");
console.log(`  companyId: ${companyId}`);
console.log(`  prefix:    ${prefix}`);
console.log(`  token:     ${plaintext}`);
```

- [ ] **Step 3: 動作確認（DB接続がある場合のみ）**

Run: `cd /Users/kazuyukijimbo/ipro-bot && node --env-file=.env.local scripts/issue-ai-gateway-token.mjs $(node --env-file=.env.local -e "console.log('test-co')") test-label 2>&1 | head -5`
Expected: 「発行しました」＋ prefix/token 表示（`.env.local` が無い環境ではスキップ。発行したテストトークンは後で `update ai_gateway_tokens set revoked_at = now() where company_id = 'test-co'` で失効しておく）

- [ ] **Step 4: Commit**

```bash
cd /Users/kazuyukijimbo/ipro-bot
git add scripts/issue-ai-gateway-token.mjs
git commit -m "feat(ai-gateway): トークン発行スクリプトを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

# Part B: Brain Pro バックエンド

### Task 6: IproBotConnection モデル（Prisma）

**Files:**
- Modify: `/Users/kazuyukijimbo/ai-data-flow/backend/prisma/schema.prisma`（Organization モデル L182-199 に back-relation 追加＋新モデル追加）

**Interfaces:**
- Produces: Prisma delegate `prisma.iproBotConnection`（fields: id, organizationId, baseUrl, apiTokenEnc, enabled, strict, createdAt, updatedAt。`@@unique([organizationId])`）— Task 8/10 が使う

- [ ] **Step 1: スキーマに追加**

`Organization` モデルの `projects Project[]` 行の直後に:

```prisma
  iproBotConnection IproBotConnection?
```

`GithubConnection` モデルの直前（または DriveConnection の隣）に新モデル:

```prisma
// 組織ごとの ipro-bot AIゲートウェイ接続設定。AI呼び出しを ipro-bot 経由に切り替える。
model IproBotConnection {
  id             String   @id @default(uuid())
  organizationId String   @map("organization_id")
  baseUrl        String   @map("base_url") // 例 https://ipro-bot.example.com
  apiTokenEnc    String   @map("api_token_enc") @db.Text // AES-256-GCM 暗号化 aig_ トークン
  enabled        Boolean  @default(true)
  strict         Boolean  @default(false) // true: ゲートウェイ障害時に直接Anthropicへフォールバックしない
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId])
  @@map("ipro_bot_connections")
}
```

- [ ] **Step 2: クライアント生成とDB適用**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx prisma db push && npx prisma generate`
Expected: `ipro_bot_connections` テーブルが作成され、client が再生成される（`migrate dev` は使わない — shadow DB で失敗する既知問題）

- [ ] **Step 3: 型チェック**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: Commit**

```bash
cd /Users/kazuyukijimbo/ai-data-flow
git add backend/prisma/schema.prisma
git commit -m "feat(ipro-bot): IproBotConnection モデルを追加（組織単位のゲートウェイ接続設定）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 7: LlmTransport（Anthropic直/ipro-bot経由）

**Files:**
- Create: `/Users/kazuyukijimbo/ai-data-flow/backend/src/infrastructure/services/llm-transport.ts`
- Test: `/Users/kazuyukijimbo/ai-data-flow/backend/src/infrastructure/services/llm-transport.spec.ts`

**Interfaces:**
- Consumes: `AnthropicUsageLike`（`./llm-usage-recorder.service`）
- Produces（Task 9/10 が使う）:
  - `interface LlmRunRequest { model: string; maxTokens: number; system?: string; messages: Anthropic.MessageParam[]; taskType: string; projectRef?: { adfOrganizationId?: string; adfProjectId?: string } }`
  - `interface LlmRunResult { text: string; model: string; usage: AnthropicUsageLike | null }`
  - `interface LlmTransport { run(req: LlmRunRequest): Promise<LlmRunResult> }`
  - `class AnthropicTransport implements LlmTransport`（constructor: `apiKey: string`）
  - `class IproBotTransport implements LlmTransport`（constructor: `baseUrl: string, apiToken: string, timeoutMs = 240_000`）
  - `class IproBotGatewayError extends Error`（field: `status: number`）
  - `function hasNonTextContent(messages: Anthropic.MessageParam[]): boolean`

- [ ] **Step 1: 失敗するテストを書く**

`llm-transport.spec.ts`:

```ts
import {
  AnthropicTransport,
  IproBotTransport,
  IproBotGatewayError,
  hasNonTextContent,
} from './llm-transport';

// AnthropicTransport は SDK をモック
const createMock = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({ messages: { create: createMock } }));
});

describe('hasNonTextContent', () => {
  it('文字列 content は false', () => {
    expect(hasNonTextContent([{ role: 'user', content: 'hi' }])).toBe(false);
  });
  it('text ブロックのみは false', () => {
    expect(
      hasNonTextContent([{ role: 'user', content: [{ type: 'text', text: 'hi' }] as any }]),
    ).toBe(false);
  });
  it('document/image ブロックを含むと true', () => {
    expect(
      hasNonTextContent([
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'x' } },
          ] as any,
        },
      ]),
    ).toBe(true);
  });
});

describe('AnthropicTransport', () => {
  beforeEach(() => {
    createMock.mockReset();
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'hello' }],
      usage: { input_tokens: 1, output_tokens: 2 },
    });
  });

  it('messages.create を呼び text と usage を返す', async () => {
    const t = new AnthropicTransport('sk-test');
    const res = await t.run({
      model: 'claude-sonnet-4-6',
      maxTokens: 100,
      system: 'SYS',
      messages: [{ role: 'user', content: 'q' }],
      taskType: 'KPI',
    });
    expect(createMock).toHaveBeenCalledWith({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      system: 'SYS',
      messages: [{ role: 'user', content: 'q' }],
    });
    expect(res).toEqual({
      text: 'hello',
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 1, output_tokens: 2 },
    });
  });

  it('system 未指定なら system を渡さない', async () => {
    const t = new AnthropicTransport('sk-test');
    await t.run({
      model: 'm',
      maxTokens: 10,
      messages: [{ role: 'user', content: 'q' }],
      taskType: 'OTHER',
    });
    expect('system' in createMock.mock.calls[0][0]).toBe(false);
  });
});

describe('IproBotTransport', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    (global as any).fetch = fetchMock;
  });

  it('/api/ai/run に Bearer 付きでPOSTし、usage を snake_case に正規化して返す', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        text: 'T',
        model: 'claude-opus-4-8',
        usage: { inputTokens: 5, outputTokens: 6, cacheReadInputTokens: 7, cacheCreationInputTokens: 8 },
      }),
    });
    const t = new IproBotTransport('https://bot.example.com/', 'aig_x');
    const res = await t.run({
      model: 'claude-sonnet-4-6',
      maxTokens: 100,
      system: 'SYS',
      messages: [{ role: 'user', content: 'q' }],
      taskType: 'KPI',
      projectRef: { adfProjectId: 'p1' },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://bot.example.com/api/ai/run'); // 末尾スラッシュは除去される
    expect(init.headers.Authorization).toBe('Bearer aig_x');
    expect(JSON.parse(init.body)).toMatchObject({ taskType: 'KPI', model: 'claude-sonnet-4-6' });
    expect(res).toEqual({
      text: 'T',
      model: 'claude-opus-4-8',
      usage: {
        input_tokens: 5,
        output_tokens: 6,
        cache_read_input_tokens: 7,
        cache_creation_input_tokens: 8,
      },
    });
  });

  it('非2xxは IproBotGatewayError(status) を投げる', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => '{"error":"budget_exceeded"}' });
    const t = new IproBotTransport('https://bot.example.com', 'aig_x');
    await expect(
      t.run({ model: 'm', maxTokens: 10, messages: [{ role: 'user', content: 'q' }], taskType: 'KPI' }),
    ).rejects.toMatchObject({ status: 429 });
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest src/infrastructure/services/llm-transport.spec.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装を書く**

`llm-transport.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';
import type { AnthropicUsageLike } from './llm-usage-recorder.service';

/** LLM 1回実行の共通リクエスト。ClaudeService の9メソッドが组み立てる。 */
export interface LlmRunRequest {
  model: string;
  maxTokens: number;
  system?: string;
  messages: Anthropic.MessageParam[];
  taskType: string; // LlmUsageArea 値
  projectRef?: { adfOrganizationId?: string; adfProjectId?: string };
}

export interface LlmRunResult {
  text: string;
  model: string;
  usage: AnthropicUsageLike | null;
}

export interface LlmTransport {
  run(req: LlmRunRequest): Promise<LlmRunResult>;
}

/** messages に text 以外の content ブロック（document/image 等）が含まれるか。 */
export function hasNonTextContent(messages: Anthropic.MessageParam[]): boolean {
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((b) => (b as { type?: string })?.type !== 'text'),
  );
}

/** 現行どおり Anthropic API を直接呼ぶトランスポート。 */
export class AnthropicTransport implements LlmTransport {
  constructor(private readonly apiKey: string) {}

  async run(req: LlmRunRequest): Promise<LlmRunResult> {
    const client = new Anthropic({ apiKey: this.apiKey });
    const response = await client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      messages: req.messages,
      ...(req.system ? { system: req.system } : {}),
    });
    const text = response.content
      .filter((c): c is Anthropic.TextBlock => c.type === 'text')
      .map((c) => c.text)
      .join('');
    return { text, model: req.model, usage: (response as any).usage ?? null };
  }
}

export class IproBotGatewayError extends Error {
  constructor(
    public readonly status: number,
    body: string,
  ) {
    super(`ipro-bot gateway error ${status}: ${body}`);
  }
}

/** ipro-bot の POST /api/ai/run に委譲するトランスポート。リトライは呼び出し元ジョブ基盤の責務。 */
export class IproBotTransport implements LlmTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly apiToken: string,
    private readonly timeoutMs = 240_000,
  ) {}

  async run(req: LlmRunRequest): Promise<LlmRunResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/ai/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify({
          taskType: req.taskType,
          model: req.model,
          system: req.system,
          messages: req.messages,
          maxTokens: req.maxTokens,
          projectRef: req.projectRef,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new IproBotGatewayError(res.status, body.slice(0, 500));
      }
      const data = (await res.json()) as {
        text: string;
        model: string;
        usage?: {
          inputTokens?: number;
          outputTokens?: number;
          cacheReadInputTokens?: number;
          cacheCreationInputTokens?: number;
        };
      };
      return {
        text: data.text,
        model: data.model,
        usage: data.usage
          ? {
              input_tokens: data.usage.inputTokens ?? 0,
              output_tokens: data.usage.outputTokens ?? 0,
              cache_read_input_tokens: data.usage.cacheReadInputTokens ?? null,
              cache_creation_input_tokens: data.usage.cacheCreationInputTokens ?? null,
            }
          : null,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest src/infrastructure/services/llm-transport.spec.ts`
Expected: PASS（8テスト）

- [ ] **Step 5: Commit**

```bash
cd /Users/kazuyukijimbo/ai-data-flow
git add backend/src/infrastructure/services/llm-transport.ts backend/src/infrastructure/services/llm-transport.spec.ts
git commit -m "feat(ipro-bot): LlmTransport 抽象（Anthropic直/ゲートウェイ経由）を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 8: IproBotGatewayService（接続解決）

**Files:**
- Create: `/Users/kazuyukijimbo/ai-data-flow/backend/src/infrastructure/services/ipro-bot-gateway.service.ts`
- Test: `/Users/kazuyukijimbo/ai-data-flow/backend/src/infrastructure/services/ipro-bot-gateway.service.spec.ts`
- Modify: `/Users/kazuyukijimbo/ai-data-flow/backend/src/app.module.ts`（providers に追加）

**Interfaces:**
- Consumes: `prisma.project.findUnique` / `prisma.iproBotConnection.findUnique`、`CryptoService.decrypt`、env `IPRO_BOT_URL`/`IPRO_BOT_API_TOKEN`
- Produces: `@Injectable() class IproBotGatewayService`、`resolveForProject(projectId: string | null | undefined): Promise<ResolvedGateway | null>`、`interface ResolvedGateway { baseUrl: string; apiToken: string; strict: boolean; organizationId: string | null }` — Task 9 が使う

解決規則: projectId → project.organizationId → `IproBotConnection` 行。行があり enabled=true → その設定。行があり enabled=false → null（**明示OFFは env より優先**）。行が無い → env フォールバック（両env未設定なら null）。projectId 無し/project 不明 → env フォールバック。

- [ ] **Step 1: 失敗するテストを書く**

`ipro-bot-gateway.service.spec.ts`:

```ts
import { IproBotGatewayService } from './ipro-bot-gateway.service';

function makePrisma(opts: { org?: string | null; conn?: any }) {
  return {
    project: {
      findUnique: jest.fn(async () =>
        opts.org === undefined ? { organizationId: 'org1' } : opts.org ? { organizationId: opts.org } : null,
      ),
    },
    iproBotConnection: {
      findUnique: jest.fn(async () => opts.conn ?? null),
    },
  } as any;
}

const crypto = { decrypt: jest.fn((v: string) => `dec(${v})`) } as any;

describe('IproBotGatewayService.resolveForProject', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.IPRO_BOT_URL;
    delete process.env.IPRO_BOT_API_TOKEN;
    jest.clearAllMocks();
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('DB接続設定(enabled)があれば復号して返す', async () => {
    const svc = new IproBotGatewayService(
      makePrisma({ conn: { baseUrl: 'https://b', apiTokenEnc: 'ENC', enabled: true, strict: true } }),
      crypto,
    );
    expect(await svc.resolveForProject('p1')).toEqual({
      baseUrl: 'https://b',
      apiToken: 'dec(ENC)',
      strict: true,
      organizationId: 'org1',
    });
  });

  it('DB接続設定が enabled=false なら env があっても null（明示OFF優先）', async () => {
    process.env.IPRO_BOT_URL = 'https://env';
    process.env.IPRO_BOT_API_TOKEN = 'aig_env';
    const svc = new IproBotGatewayService(
      makePrisma({ conn: { baseUrl: 'https://b', apiTokenEnc: 'ENC', enabled: false, strict: false } }),
      crypto,
    );
    expect(await svc.resolveForProject('p1')).toBeNull();
  });

  it('DB接続設定が無ければ env にフォールバック', async () => {
    process.env.IPRO_BOT_URL = 'https://env';
    process.env.IPRO_BOT_API_TOKEN = 'aig_env';
    const svc = new IproBotGatewayService(makePrisma({}), crypto);
    expect(await svc.resolveForProject('p1')).toEqual({
      baseUrl: 'https://env',
      apiToken: 'aig_env',
      strict: false,
      organizationId: 'org1',
    });
  });

  it('DBもenvも無ければ null', async () => {
    const svc = new IproBotGatewayService(makePrisma({}), crypto);
    expect(await svc.resolveForProject('p1')).toBeNull();
  });

  it('projectId 無しは env のみ参照', async () => {
    process.env.IPRO_BOT_URL = 'https://env';
    process.env.IPRO_BOT_API_TOKEN = 'aig_env';
    const prisma = makePrisma({});
    const svc = new IproBotGatewayService(prisma, crypto);
    expect(await svc.resolveForProject(undefined)).toEqual({
      baseUrl: 'https://env',
      apiToken: 'aig_env',
      strict: false,
      organizationId: null,
    });
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest src/infrastructure/services/ipro-bot-gateway.service.spec.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装を書く**

`ipro-bot-gateway.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../persistence/prisma/prisma.service';
import { CryptoService } from './crypto.service';

export interface ResolvedGateway {
  baseUrl: string;
  apiToken: string;
  strict: boolean;
  organizationId: string | null;
}

/** projectId から組織の ipro-bot ゲートウェイ接続設定を解決する。DB設定 > env、明示OFFは env より優先。 */
@Injectable()
export class IproBotGatewayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async resolveForProject(
    projectId: string | null | undefined,
  ): Promise<ResolvedGateway | null> {
    if (!projectId) return this.envGateway(null);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { organizationId: true },
    });
    if (!project) return this.envGateway(null);

    const conn = await this.prisma.iproBotConnection.findUnique({
      where: { organizationId: project.organizationId },
    });
    if (conn) {
      if (!conn.enabled) return null; // 明示OFF
      return {
        baseUrl: conn.baseUrl,
        apiToken: this.crypto.decrypt(conn.apiTokenEnc),
        strict: conn.strict,
        organizationId: project.organizationId,
      };
    }
    return this.envGateway(project.organizationId);
  }

  private envGateway(organizationId: string | null): ResolvedGateway | null {
    const baseUrl = process.env.IPRO_BOT_URL;
    const apiToken = process.env.IPRO_BOT_API_TOKEN;
    if (!baseUrl || !apiToken) return null;
    return { baseUrl, apiToken, strict: false, organizationId };
  }
}
```

- [ ] **Step 4: app.module.ts に登録**

import 節（`ClaudeService` の import 行の隣）に:

```ts
import { IproBotGatewayService } from './infrastructure/services/ipro-bot-gateway.service';
```

providers 配列の `// ========== Services ==========` セクション（`ClaudeService,` の隣）に:

```ts
    IproBotGatewayService,
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest src/infrastructure/services/ipro-bot-gateway.service.spec.ts && npx tsc --noEmit`
Expected: PASS（5テスト）＋型エラーなし

- [ ] **Step 6: Commit**

```bash
cd /Users/kazuyukijimbo/ai-data-flow
git add backend/src/infrastructure/services/ipro-bot-gateway.service.ts backend/src/infrastructure/services/ipro-bot-gateway.service.spec.ts backend/src/app.module.ts
git commit -m "feat(ipro-bot): 組織単位のゲートウェイ接続解決サービスを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 9: ClaudeService に runLlm ヘルパを導入（フォールバック実装）

**Files:**
- Modify: `/Users/kazuyukijimbo/ai-data-flow/backend/src/infrastructure/services/claude.service.ts`（constructor＋private ヘルパ追加。9メソッドの移行は Task 10）
- Test: `/Users/kazuyukijimbo/ai-data-flow/backend/src/infrastructure/services/claude.service.gateway.spec.ts`

**Interfaces:**
- Consumes: Task 7 の transports、Task 8 の `IproBotGatewayService`
- Produces: `private async runLlm(input: { apiKey: string; model: string; maxTokens: number; system?: string; messages: Anthropic.MessageParam[]; usage?: LlmUsageContext }): Promise<LlmRunResult>` — Task 10 の9メソッドが呼ぶ。フォールバック規則は Global Constraints のとおり

- [ ] **Step 1: 失敗するテストを書く**

`claude.service.gateway.spec.ts`（runLlm は private のため、Task 10 で最初に移行する `parseRequirements` 経由でテストする。このテストは Task 10 Step 1 の parseRequirements 移行と同時に green になる — 本タスクでは runLlm 実装＋このテストの RED まで）:

```ts
import { ClaudeService } from './claude.service';
import { IproBotGatewayError } from './llm-transport';

const createMock = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({ messages: { create: createMock } }));
});

const usageRecorder = { record: jest.fn(async () => {}) } as any;

function makeGateway(resolved: any) {
  return { resolveForProject: jest.fn(async () => resolved) } as any;
}

const VALID_JSON = '{"requirements":[]}';

describe('ClaudeService runLlm（parseRequirements 経由）', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = fetchMock;
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: VALID_JSON }],
      usage: { input_tokens: 1, output_tokens: 2 },
    });
  });

  it('ゲートウェイ未設定(null)なら直接Anthropic', async () => {
    const svc = new ClaudeService(usageRecorder, makeGateway(null));
    await svc.parseRequirements('text', 'sk-key', { projectId: 'p1', area: 'REQUIREMENT' });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ゲートウェイ設定ありなら /api/ai/run を呼ぶ', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ text: VALID_JSON, model: 'claude-opus-4-8', usage: { inputTokens: 3, outputTokens: 4 } }),
    });
    const svc = new ClaudeService(
      usageRecorder,
      makeGateway({ baseUrl: 'https://b', apiToken: 'aig_x', strict: false, organizationId: 'o1' }),
    );
    await svc.parseRequirements('text', 'sk-key', { projectId: 'p1', area: 'REQUIREMENT' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
    // usage は実際に使われたモデル名で記録される
    expect(usageRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1' }),
      'claude-opus-4-8',
      expect.objectContaining({ input_tokens: 3 }),
    );
  });

  it('ゲートウェイ5xxは直接Anthropicへフォールバック', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, text: async () => 'boom' });
    const svc = new ClaudeService(
      usageRecorder,
      makeGateway({ baseUrl: 'https://b', apiToken: 'aig_x', strict: false, organizationId: 'o1' }),
    );
    const res = await svc.parseRequirements('text', 'sk-key', { projectId: 'p1', area: 'REQUIREMENT' });
    expect(res).toEqual({ requirements: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledTimes(1); // フォールバック実行
  });

  it('strict=true はフォールバックせず throw', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, text: async () => 'boom' });
    const svc = new ClaudeService(
      usageRecorder,
      makeGateway({ baseUrl: 'https://b', apiToken: 'aig_x', strict: true, organizationId: 'o1' }),
    );
    await expect(
      svc.parseRequirements('text', 'sk-key', { projectId: 'p1', area: 'REQUIREMENT' }),
    ).rejects.toBeInstanceOf(IproBotGatewayError);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('401 はフォールバックせず throw（設定ミスの顕在化）', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' });
    const svc = new ClaudeService(
      usageRecorder,
      makeGateway({ baseUrl: 'https://b', apiToken: 'aig_bad', strict: false, organizationId: 'o1' }),
    );
    await expect(
      svc.parseRequirements('text', 'sk-key', { projectId: 'p1', area: 'REQUIREMENT' }),
    ).rejects.toMatchObject({ status: 401 });
    expect(createMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest src/infrastructure/services/claude.service.gateway.spec.ts`
Expected: FAIL（constructor が第2引数を取らない／parseRequirements がまだ transport を使わない）

- [ ] **Step 3: claude.service.ts に import・constructor・runLlm を追加**

import 節（既存 `import Anthropic from '@anthropic-ai/sdk';` の下）に:

```ts
import { Logger } from '@nestjs/common';
import {
  AnthropicTransport,
  IproBotTransport,
  IproBotGatewayError,
  hasNonTextContent,
  LlmRunRequest,
  LlmRunResult,
} from './llm-transport';
import { IproBotGatewayService } from './ipro-bot-gateway.service';
```

constructor（L208）を置換:

```ts
  private readonly logger = new Logger(ClaudeService.name);

  constructor(
    private readonly usageRecorder: LlmUsageRecorder,
    private readonly gatewayService: IproBotGatewayService,
  ) {}
```

`getClient` の直後に private ヘルパを追加:

```ts
  /**
   * LLM 1回実行の共通経路。組織の ipro-bot 連携が有効ならゲートウェイ経由、
   * それ以外・マルチモーダル・フォールバック時は直接 Anthropic を呼ぶ。
   */
  private async runLlm(input: {
    apiKey: string;
    model: string;
    maxTokens: number;
    system?: string;
    messages: Anthropic.MessageParam[];
    usage?: LlmUsageContext;
  }): Promise<LlmRunResult> {
    const direct = new AnthropicTransport(input.apiKey);
    const req: LlmRunRequest = {
      model: input.model,
      maxTokens: input.maxTokens,
      system: input.system,
      messages: input.messages,
      taskType: input.usage?.area ?? 'OTHER',
      projectRef: input.usage?.projectId ? { adfProjectId: input.usage.projectId } : undefined,
    };

    // マルチモーダル（PDF/画像）はゲートウェイのボディ上限にかかるため P1 では直接実行
    if (hasNonTextContent(input.messages)) return direct.run(req);

    const gateway = await this.gatewayService.resolveForProject(input.usage?.projectId);
    if (!gateway) return direct.run(req);

    const via = new IproBotTransport(gateway.baseUrl, gateway.apiToken);
    try {
      return await via.run(req);
    } catch (err) {
      const status = err instanceof IproBotGatewayError ? err.status : null;
      if (status === 401 || gateway.strict) throw err; // 設定ミスは顕在化 / strict はフォールバック禁止
      this.logger.warn(
        `ipro-botゲートウェイ失敗のため直接Anthropicへフォールバック: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return direct.run(req);
    }
  }
```

- [ ] **Step 4: 型チェック（テストはまだREDでよい）**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx tsc --noEmit`
Expected: エラーなし（runLlm は未使用 private だが `noUnusedLocals` が有効でエラーになる場合は Task 10 と同一コミットにまとめる）

- [ ] **Step 5: Commit（Task 10 と分けられない場合はまとめてよい）**

```bash
cd /Users/kazuyukijimbo/ai-data-flow
git add backend/src/infrastructure/services/claude.service.ts backend/src/infrastructure/services/claude.service.gateway.spec.ts
git commit -m "feat(ipro-bot): ClaudeService に runLlm 共通経路（ゲートウェイ/フォールバック）を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 10: 9メソッドを runLlm に移行

**Files:**
- Modify: `/Users/kazuyukijimbo/ai-data-flow/backend/src/infrastructure/services/claude.service.ts`

**Interfaces:**
- Consumes: Task 9 の `runLlm`
- Produces: 9公開メソッドの挙動不変（シグネチャ・JSONパース・エラーメッセージそのまま）。`client.messages.create` の直接呼び出しが claude.service.ts から消える

各メソッドの現行呼び出し（行番号は着手時にズレうる。`client.messages.create` で grep して特定する）:

| メソッド | model | max_tokens | system | content |
|---|---|---|---|---|
| parseRequirements (L217) | defaultModel() | 8192 | あり | 文字列 |
| refineRequirement (L298) | defaultModel() | 4096 | **なし** | 文字列 |
| parseMermaidToFlow (L351) | defaultModel() | 8192 | あり | 文字列 |
| parseMermaidToObjectMap (L435) | defaultModel() | 8192 | あり | 文字列 |
| extractKnowledge (L547) | 引数model ?? defaultModel() | 4096 | あり | **ブロック配列（マルチモーダル）** |
| suggestIssueNodes (L668) | defaultModel() | 2048 | あり | 文字列 |
| generateKpis (L795) | defaultModel() | 8192 | あり | 文字列 |
| extractTasksFromSpreadsheet (L935) | defaultModel() | 8192 | あり | 文字列 |
| analyzeProjectReadiness (L1021) | analysisModel() | 2048 | あり | 文字列 |

- [ ] **Step 1: parseRequirements を移行（テンプレ）**

各メソッド共通の置換パターン。parseRequirements の場合、現行:

```ts
    const client = this.getClient(apiKey);
    const model = this.defaultModel();
    // ...systemPrompt定義...
    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `以下のテキストを要求定義に変換してください：

${naturalLanguageText}`,
        },
      ],
      system: systemPrompt,
    });
    if (usage) await this.usageRecorder.record(usage, model, (response as any).usage);

    // レスポンスからテキストを抽出
    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('Claude APIからの応答が不正です');
    }
```

置換後:

```ts
    const model = this.defaultModel();
    // ...systemPrompt定義（不変）...
    const run = await this.runLlm({
      apiKey,
      model,
      maxTokens: 8192,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `以下のテキストを要求定義に変換してください：

${naturalLanguageText}`,
        },
      ],
      usage,
    });
    if (usage) await this.usageRecorder.record(usage, run.model, run.usage);

    if (!run.text) {
      throw new Error('Claude APIからの応答が不正です');
    }
```

後続の JSON パース部は `textContent.text` → `run.text` に置換（`console.error('JSON parse error:', textContent.text)` も `run.text` に）。

- [ ] **Step 2: gateway スペックが通ることを確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest src/infrastructure/services/claude.service.gateway.spec.ts`
Expected: PASS（5テスト — Task 9 で書いたテストがここで green になる）

- [ ] **Step 3: 残り8メソッドを同じパターンで移行**

各メソッドで機械的に:
1. `const client = this.getClient(apiKey);` 行を削除
2. `const response = await client.messages.create({ model|usedModel, max_tokens: N, messages: [...], system?: sysPrompt })` → `const run = await this.runLlm({ apiKey, model: <同じ式>, maxTokens: N, system: <同じ式（refineRequirement は省略）>, messages: <同じ配列>, usage })`
3. `this.usageRecorder.record(usage, <model変数>, (response as any).usage)` → `this.usageRecorder.record(usage, run.model, run.usage)`
4. `const textContent = response.content.find((c) => c.type === 'text'); if (!textContent || textContent.type !== 'text') { throw ... }` → `if (!run.text) { throw ...（メッセージ不変） }`
5. 以降の `textContent.text` を `run.text` に置換

注意点:
- `extractKnowledge` は `content` がブロック配列だが、そのまま `messages: [{ role: 'user', content }]` を渡せばよい（`hasNonTextContent` により runLlm 内で自動的に直接実行になる。テキストのみ入力のときはゲートウェイ経由になる）。`usedModel` 変数は `model: usedModel` として渡し、record も `run.model` に。
- `refineRequirement` は `system` キーを渡さない（`system: undefined` でも可 — AnthropicTransport/gateway 双方が省略扱いする）。
- `analyzeProjectReadiness` は `model: this.analysisModel()`。

- [ ] **Step 4: 直接呼び出しが残っていないことを確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && grep -n "client.messages.create\|getClient(" src/infrastructure/services/claude.service.ts`
Expected: `getClient` の定義行のみ（呼び出しゼロになったら `getClient` メソッド自体と `private getClient` 定義を削除し、grep 結果ゼロにする）

- [ ] **Step 5: 全回帰テスト**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npm test`
Expected: 全green（既存142＋新規。ClaudeService を `new` している既存specがあれば constructor 第2引数に `{ resolveForProject: async () => null } as any` を渡す修正を入れる）

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 6: Commit**

```bash
cd /Users/kazuyukijimbo/ai-data-flow
git add backend/src/infrastructure/services/claude.service.ts
git commit -m "feat(ipro-bot): ClaudeService 全9メソッドを runLlm 経由に移行

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 11: 接続設定コントローラ（GET/PUT/test）

**Files:**
- Create: `/Users/kazuyukijimbo/ai-data-flow/backend/src/presentation/controllers/ipro-bot-connection.controller.ts`
- Test: `/Users/kazuyukijimbo/ai-data-flow/backend/src/presentation/controllers/ipro-bot-connection.controller.spec.ts`
- Modify: `/Users/kazuyukijimbo/ai-data-flow/backend/src/app.module.ts`（controllers に追加）

**Interfaces:**
- Consumes: `PrismaService`、`CryptoService`、`@CurrentUser()`/`CurrentUserPayload`、domain `ForbiddenError`
- Produces（Task 12 のフロントが呼ぶ）:
  - `GET /api/organizations/:organizationId/ipro-bot` → `{ configured: boolean; baseUrl?: string; enabled?: boolean; strict?: boolean; hasApiToken?: boolean }`
  - `PUT /api/organizations/:organizationId/ipro-bot` body `{ baseUrl?, apiToken?, enabled?, strict? }` → 同上（apiToken は空/未指定なら変更しない）
  - `POST /api/organizations/:organizationId/ipro-bot/test` → `{ ok: boolean; detail?: string; error?: string }`

- [ ] **Step 1: 失敗するテストを書く**

`ipro-bot-connection.controller.spec.ts`:

```ts
import { IproBotConnectionController } from './ipro-bot-connection.controller';
import { ForbiddenError } from '../../domain';

function makePrisma(opts: { role?: string | null; isSuperAdmin?: boolean; conn?: any }) {
  return {
    user: {
      findUnique: jest.fn(async () => ({ isSuperAdmin: opts.isSuperAdmin ?? false })),
    },
    organizationMember: {
      findUnique: jest.fn(async () => (opts.role ? { role: opts.role } : null)),
    },
    iproBotConnection: {
      findUnique: jest.fn(async () => opts.conn ?? null),
      upsert: jest.fn(async (args: any) => ({
        baseUrl: args.create.baseUrl,
        apiTokenEnc: args.create.apiTokenEnc,
        enabled: args.create.enabled,
        strict: args.create.strict,
      })),
    },
  } as any;
}

const crypto = {
  encrypt: jest.fn((v: string) => `enc(${v})`),
  decrypt: jest.fn((v: string) => `dec(${v})`),
} as any;

const user = { id: 'u1', email: 'a@b.c' } as any;

describe('IproBotConnectionController', () => {
  beforeEach(() => jest.clearAllMocks());

  it('管理者でなければ ForbiddenError', async () => {
    const c = new IproBotConnectionController(makePrisma({ role: 'MEMBER' }), crypto);
    await expect(c.get(user, 'org1')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('GET: 未設定なら configured=false', async () => {
    const c = new IproBotConnectionController(makePrisma({ role: 'ADMIN' }), crypto);
    expect(await c.get(user, 'org1')).toEqual({ configured: false });
  });

  it('GET: 設定済みは秘密を返さず hasApiToken のみ', async () => {
    const c = new IproBotConnectionController(
      makePrisma({
        role: 'OWNER',
        conn: { baseUrl: 'https://b', apiTokenEnc: 'ENC', enabled: true, strict: false },
      }),
      crypto,
    );
    const res = await c.get(user, 'org1');
    expect(res).toEqual({
      configured: true,
      baseUrl: 'https://b',
      enabled: true,
      strict: false,
      hasApiToken: true,
    });
    expect(JSON.stringify(res)).not.toContain('ENC');
  });

  it('PUT: 新規作成には baseUrl と apiToken が必須', async () => {
    const c = new IproBotConnectionController(makePrisma({ role: 'ADMIN' }), crypto);
    await expect(c.upsert(user, 'org1', { enabled: true } as any)).rejects.toThrow();
  });

  it('PUT: apiToken は暗号化して保存する', async () => {
    const prisma = makePrisma({ role: 'ADMIN' });
    const c = new IproBotConnectionController(prisma, crypto);
    await c.upsert(user, 'org1', { baseUrl: 'https://b', apiToken: 'aig_x' } as any);
    expect(crypto.encrypt).toHaveBeenCalledWith('aig_x');
    const args = prisma.iproBotConnection.upsert.mock.calls[0][0];
    expect(args.create.apiTokenEnc).toBe('enc(aig_x)');
  });

  it('test: /api/ai/health を復号トークンで叩き ok を返す', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, companyId: 'co1' }),
    }));
    (global as any).fetch = fetchMock;
    const c = new IproBotConnectionController(
      makePrisma({
        role: 'ADMIN',
        conn: { baseUrl: 'https://b/', apiTokenEnc: 'ENC', enabled: true, strict: false },
      }),
      crypto,
    );
    const res = await c.test(user, 'org1');
    expect(res).toEqual({ ok: true, detail: 'companyId=co1' });
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('https://b/api/ai/health');
    expect(init.headers.Authorization).toBe('Bearer dec(ENC)');
  });

  it('test: 未設定は ok=false', async () => {
    const c = new IproBotConnectionController(makePrisma({ role: 'ADMIN' }), crypto);
    expect(await c.test(user, 'org1')).toEqual({ ok: false, error: '未設定です' });
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest src/presentation/controllers/ipro-bot-connection.controller.spec.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: コントローラを実装**

`ipro-bot-connection.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { CryptoService } from '../../infrastructure/services/crypto.service';
import { CurrentUser, CurrentUserPayload } from '../decorators/current-user.decorator';
import { ForbiddenError, ValidationError } from '../../domain';

class UpdateIproBotConnectionDto {
  @IsOptional() @IsString() baseUrl?: string;
  @IsOptional() @IsString() apiToken?: string; // 空/未指定なら変更しない（伏字運用）
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() strict?: boolean;
}

interface IproBotConnectionView {
  configured: boolean;
  baseUrl?: string;
  enabled?: boolean;
  strict?: boolean;
  hasApiToken?: boolean;
}

// 組織ごとの ipro-bot AIゲートウェイ接続設定。会社管理者（superAdmin/OWNER/ADMIN）のみ。
@ApiTags('ipro-bot連携')
@ApiBearerAuth()
@Controller('organizations/:organizationId/ipro-bot')
export class IproBotConnectionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  private async assertCompanyAdmin(organizationId: string, userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });
    if (user?.isSuperAdmin) return;

    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true },
    });
    if (member && (member.role === 'OWNER' || member.role === 'ADMIN')) {
      return;
    }
    throw new ForbiddenError('この会社を管理する権限がありません');
  }

  private toView(conn: {
    baseUrl: string;
    apiTokenEnc: string;
    enabled: boolean;
    strict: boolean;
  } | null): IproBotConnectionView {
    if (!conn) return { configured: false };
    return {
      configured: true,
      baseUrl: conn.baseUrl,
      enabled: conn.enabled,
      strict: conn.strict,
      hasApiToken: !!conn.apiTokenEnc,
    };
  }

  @Get()
  @ApiOperation({ summary: 'ipro-bot 接続設定を取得（秘密は返さない）' })
  async get(
    @CurrentUser() user: CurrentUserPayload,
    @Param('organizationId') organizationId: string,
  ): Promise<IproBotConnectionView> {
    await this.assertCompanyAdmin(organizationId, user.id);
    const conn = await this.prisma.iproBotConnection.findUnique({ where: { organizationId } });
    return this.toView(conn);
  }

  @Put()
  @ApiOperation({ summary: 'ipro-bot 接続設定を作成/更新（apiToken は空なら変更しない）' })
  async upsert(
    @CurrentUser() user: CurrentUserPayload,
    @Param('organizationId') organizationId: string,
    @Body() dto: UpdateIproBotConnectionDto,
  ): Promise<IproBotConnectionView> {
    await this.assertCompanyAdmin(organizationId, user.id);
    const existing = await this.prisma.iproBotConnection.findUnique({ where: { organizationId } });
    if (!existing && (!dto.baseUrl || !dto.apiToken)) {
      throw new ValidationError('初回設定には baseUrl と apiToken が必要です');
    }

    const tokenUpdate = dto.apiToken ? { apiTokenEnc: this.crypto.encrypt(dto.apiToken) } : {};
    const saved = await this.prisma.iproBotConnection.upsert({
      where: { organizationId },
      update: {
        ...(dto.baseUrl !== undefined ? { baseUrl: dto.baseUrl } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.strict !== undefined ? { strict: dto.strict } : {}),
        ...tokenUpdate,
      },
      create: {
        organizationId,
        baseUrl: dto.baseUrl!,
        apiTokenEnc: this.crypto.encrypt(dto.apiToken!),
        enabled: dto.enabled ?? true,
        strict: dto.strict ?? false,
      },
    });
    return this.toView(saved);
  }

  @Post('test')
  @ApiOperation({ summary: '接続テスト（ipro-bot の /api/ai/health を叩く）' })
  async test(
    @CurrentUser() user: CurrentUserPayload,
    @Param('organizationId') organizationId: string,
  ): Promise<{ ok: boolean; detail?: string; error?: string }> {
    await this.assertCompanyAdmin(organizationId, user.id);
    const conn = await this.prisma.iproBotConnection.findUnique({ where: { organizationId } });
    if (!conn) return { ok: false, error: '未設定です' };
    try {
      const res = await fetch(`${conn.baseUrl.replace(/\/$/, '')}/api/ai/health`, {
        headers: { Authorization: `Bearer ${this.crypto.decrypt(conn.apiTokenEnc)}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const data = (await res.json()) as { ok?: boolean; companyId?: string };
      return { ok: true, detail: `companyId=${data.companyId ?? '不明'}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
```

（`ValidationError` が `../../domain` から export されていない場合は `organization.controller.ts` の import を確認し、同じエラークラス（例: `BadRequestException`）に合わせる）

- [ ] **Step 4: app.module.ts に登録**

import 節（`OrganizationController` の隣）:

```ts
import { IproBotConnectionController } from './presentation/controllers/ipro-bot-connection.controller';
```

controllers 配列（`OrganizationController,` の隣）:

```ts
    IproBotConnectionController,
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npx jest src/presentation/controllers/ipro-bot-connection.controller.spec.ts && npx tsc --noEmit`
Expected: PASS（8テスト）＋型エラーなし

- [ ] **Step 6: Commit**

```bash
cd /Users/kazuyukijimbo/ai-data-flow
git add backend/src/presentation/controllers/ipro-bot-connection.controller.ts backend/src/presentation/controllers/ipro-bot-connection.controller.spec.ts backend/src/app.module.ts
git commit -m "feat(ipro-bot): 接続設定API（GET/PUT/接続テスト）を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

# Part C: Brain Pro フロントエンド＋ドキュメント

### Task 12: 会社設定に ipro-bot連携パネル

**Files:**
- Modify: `/Users/kazuyukijimbo/ai-data-flow/frontend/src/lib/api.ts`（`iproBotApi` 追加）
- Create: `/Users/kazuyukijimbo/ai-data-flow/frontend/src/components/company/IproBotPanel.tsx`
- Modify: `/Users/kazuyukijimbo/ai-data-flow/frontend/src/app/(dashboard)/dashboard/companies/[orgId]/page.tsx`（`ai` タブ内にパネルをマウント）

**Interfaces:**
- Consumes: Task 11 の3エンドポイント、既存 `api<T>()` ヘルパ
- Produces: `iproBotApi = { get(orgId), update(orgId, body), test(orgId) }`、`<IproBotPanel orgId={string} />`

- [ ] **Step 1: api.ts に iproBotApi を追加**

`invitesApi` の直後に:

```ts
// ipro-bot連携（組織単位のAIゲートウェイ設定）
export interface IproBotConnectionView {
  configured: boolean;
  baseUrl?: string;
  enabled?: boolean;
  strict?: boolean;
  hasApiToken?: boolean;
}

export const iproBotApi = {
  get: (orgId: string) => api<IproBotConnectionView>(`/organizations/${orgId}/ipro-bot`),
  update: (
    orgId: string,
    body: { baseUrl?: string; apiToken?: string; enabled?: boolean; strict?: boolean },
  ) =>
    api<IproBotConnectionView>(`/organizations/${orgId}/ipro-bot`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  test: (orgId: string) =>
    api<{ ok: boolean; detail?: string; error?: string }>(`/organizations/${orgId}/ipro-bot/test`, {
      method: 'POST',
    }),
};
```

- [ ] **Step 2: パネルコンポーネントを作成**

`frontend/src/components/company/IproBotPanel.tsx`（InviteLinksPanel の枠＋trackerパネルの伏字/接続テストパターン）:

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle2, Loader2, PlugZap, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { iproBotApi, type IproBotConnectionView } from '@/lib/api';

// 簡易トグルスイッチ（switch コンポーネントが無いためインライン実装）
function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-50 ${
        checked ? 'bg-blue-600' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function IproBotPanel({ orgId }: { orgId: string }) {
  const [view, setView] = useState<IproBotConnectionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [strict, setStrict] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const v = await iproBotApi.get(orgId);
      setView(v);
      setBaseUrl(v.baseUrl ?? '');
      setEnabled(v.enabled ?? true);
      setStrict(v.strict ?? false);
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : '読み込みに失敗しました' });
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const v = await iproBotApi.update(orgId, {
        baseUrl,
        ...(apiToken.length > 0 ? { apiToken } : {}),
        enabled,
        strict,
      });
      setView(v);
      setApiToken('');
      setMsg({ kind: 'ok', text: '保存しました' });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : '保存に失敗しました' });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setMsg(null);
    try {
      const res = await iproBotApi.test(orgId);
      setMsg(
        res.ok
          ? { kind: 'ok', text: `接続に成功しました（${res.detail ?? ''}）` }
          : { kind: 'err', text: `接続に失敗しました${res.error ? `: ${res.error}` : ''}` },
      );
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : '接続テストに失敗しました' });
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 rounded-xl border border-border p-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-border p-4">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold text-foreground">ipro-bot連携（AIゲートウェイ）</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        有効にすると、このプロジェクト群のAI機能（要求定義・課題提案・KPI生成など）が ipro-bot
        経由で実行され、IPLoT頭脳とAI予算管理が適用されます。
      </p>

      {msg && (
        <div
          className={`flex items-start gap-2 rounded-lg border p-2.5 text-sm ${
            msg.kind === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {msg.kind === 'ok' ? (
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
          ) : (
            <X className="h-4 w-4 flex-shrink-0 mt-0.5" />
          )}
          <span className="break-all">{msg.text}</span>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>ゲートウェイURL</Label>
        <Input
          placeholder="https://ipro-bot.example.com"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label>APIトークン（aig_...）</Label>
        <Input
          type="password"
          autoComplete="new-password"
          placeholder={view?.hasApiToken ? '設定済み（変更する場合のみ入力）' : 'aig_ トークンを入力'}
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">
          保存後は値を表示できません（伏字運用）。{view?.hasApiToken && '空のままなら変更されません。'}
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <Label>連携を有効にする</Label>
          <p className="text-xs text-muted-foreground">OFFにすると従来どおり直接Anthropicを呼びます</p>
        </div>
        <Toggle checked={enabled} onChange={setEnabled} />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <Label>厳格モード</Label>
          <p className="text-xs text-muted-foreground">
            ゲートウェイ障害時に直接Anthropicへフォールバックせずエラーにします
          </p>
        </div>
        <Toggle checked={strict} onChange={setStrict} />
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={saving || !baseUrl}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          保存
        </Button>
        <Button
          variant="outline"
          onClick={test}
          disabled={testing || !view?.configured}
          title="ipro-bot の /api/ai/health への到達とトークンを確認します"
          className="gap-1.5"
        >
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
          接続テスト
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 会社設定ページにマウント**

`companies/[orgId]/page.tsx` の `ai` タブの `<Card>`（Anthropic APIキー設定の Card）の直後に追加:

```tsx
<IproBotPanel orgId={orgId} />
```

import 節に:

```tsx
import { IproBotPanel } from '@/components/company/IproBotPanel';
```

- [ ] **Step 4: ビルド確認**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/frontend && npx tsc --noEmit && npm run build`
Expected: 型エラーなし・next build 成功

- [ ] **Step 5: Commit**

```bash
cd /Users/kazuyukijimbo/ai-data-flow
git add frontend/src/lib/api.ts frontend/src/components/company/IproBotPanel.tsx "frontend/src/app/(dashboard)/dashboard/companies/[orgId]/page.tsx"
git commit -m "feat(ipro-bot): 会社設定に ipro-bot連携パネル（保存/接続テスト）を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 13: env例・ドキュメント更新＋最終回帰

**Files:**
- Modify: `/Users/kazuyukijimbo/ai-data-flow/backend/.env.example`（存在する場合。無ければ ルートの `.env.example` を確認）
- Modify: `/Users/kazuyukijimbo/ai-data-flow/docs/ai-integration.md`

**Interfaces:**
- Consumes: 全タスクの成果
- Produces: 運用ドキュメント

- [ ] **Step 1: .env.example に追記**

`backend/.env.example`（Google ログイン env が追記されているファイル）の末尾に:

```bash
# ipro-bot AIゲートウェイ（組織のDB設定が無い場合のフォールバック。両方設定で有効）
IPRO_BOT_URL=
IPRO_BOT_API_TOKEN=
```

- [ ] **Step 2: docs/ai-integration.md に節を追記**

「## ipro-bot AIゲートウェイ連携」節を追加し、以下を記載（実ファイルの見出しレベル・体裁に合わせる）:

```markdown
## ipro-bot AIゲートウェイ連携

組織単位で AI 呼び出しを ipro-bot の `POST /api/ai/run` 経由に切り替えられる。
設計: `docs/superpowers/specs/2026-07-11-ipro-bot-ai-gateway-design.md`

- 設定: 会社設定ページの「ipro-bot連携」パネル（baseUrl / aig_ トークン / 有効 / 厳格モード）。
  DB設定が無い場合は env `IPRO_BOT_URL` + `IPRO_BOT_API_TOKEN` にフォールバック。
- トークン発行（ipro-bot 側）: `node --env-file=.env.local scripts/issue-ai-gateway-token.mjs <companyId> [label]`
- 経由時の挙動: taskType（LlmUsageArea）に応じて IPLoT頭脳（method.md）が system 先頭に注入され、
  ipro-bot 側の会社別AI予算ガード・usage記録が適用される。usage は従来どおり Brain Pro の LlmUsageLog にも記録される。
- フォールバック: ゲートウェイ障害時は直接 Anthropic に自動フォールバック（厳格モード時と 401 は即エラー）。
- 制限（P1）: マルチモーダル（PDF/画像を含むナレッジ抽出）は常に直接 Anthropic。
```

- [ ] **Step 3: 両リポジトリの最終回帰**

Run: `cd /Users/kazuyukijimbo/ai-data-flow/backend && npm test && npx tsc --noEmit`
Expected: 全green

Run: `cd /Users/kazuyukijimbo/ai-data-flow/frontend && npx tsc --noEmit`
Expected: エラーなし

Run: `cd /Users/kazuyukijimbo/ipro-bot && npm test && npm run build`
Expected: 全green・ビルド成功

- [ ] **Step 4: Commit**

```bash
cd /Users/kazuyukijimbo/ai-data-flow
git add backend/.env.example docs/ai-integration.md
git commit -m "docs(ipro-bot): AIゲートウェイ連携の運用ドキュメントと env例を追記

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 実施しないこと（YAGNI 確認）

- Structured Outputs のゲートウェイパススルー（P3）
- プロジェクト文脈（project_memory/context）注入と links テーブル（P2 — 理解ノート同期スペックと合流）
- ipro-bot コンソールUIでの aig トークン発行画面（P1 はスクリプト発行で足りる）
- 新 LlmUsageArea 値の追加（既存 area のまま記録で十分）
- フォールバック発生の管理ダッシュボード（P3）
