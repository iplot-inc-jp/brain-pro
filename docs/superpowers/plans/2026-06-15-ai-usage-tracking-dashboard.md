# AI使用量の記録・可視化・プロジェクト設定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** すべての Claude(Anthropic) 呼び出しのトークン使用量を機能領域別/モデル別に記録し、プロジェクト単位の「AI使用量」ページで input/output トークン＋概算コストを可視化、既存 AI抽出/OCR/モデル設定を同ページから編集できるようにする。

**Architecture:** 新モデル `LlmUsageLog` に使用量を1行/呼び出しで記録。記録は `ClaudeService` / `CodeExtractionService` に中央集約（`LlmUsageRecorder`、try/catch で AI 本処理を壊さない）。各呼び出し元が `{projectId, area, userId?}` を渡す。集計は clean-arch スライス `llm-usage`（groupBy + 単価表）。フロントは新ページ＋既存 `ProjectKnowledgeSettings` の編集パネル再利用。

**Tech Stack:** NestJS, Prisma(PostgreSQL, `prisma db push`), @anthropic-ai/sdk, Next.js(App Router), jest(backend), vitest(frontend)。

**前提（実環境）:** backend dev = `npm run start:dev`(watch, :5021)、pg docker :5460、FE :3007、demo@iplot.local/password123。スキーマ変更後は `npx prisma db push --schema=./prisma/schema.prisma` ＋ watch 再起動。各タスク後 backend `npm test`＋`npm run build` / frontend `npx tsc --noEmit`＋`npm test` が緑。コミットは **feat/methodology-pipeline 上**（新ブランチを作らない）。

**重要・現行コード確認:** `claude.service.ts` は8メソッド（parseRequirements/refineRequirement/parseMermaidToFlow/parseMermaidToObjectMap/extractKnowledge/suggestIssueNodes/generateKpis ＋getClient/defaultModel）。各メソッドは実シグネチャを Read して**任意引数 `usage?` の追加**で後方互換に改修する（本プランのコードは骨子）。`response.usage` のフィールドは `input_tokens`/`output_tokens`/`cache_read_input_tokens?`/`cache_creation_input_tokens?`。

---

## File Structure

- 追加:
  - `backend/src/infrastructure/services/llm-pricing.ts`（単価表＋純関数 estimateCostUsd）＋ `llm-pricing.spec.ts`
  - `backend/src/infrastructure/services/llm-usage-recorder.service.ts` ＋ `.spec.ts`
  - `backend/src/application/use-cases/llm-usage/get-llm-usage-summary.use-case.ts` ＋ `.spec.ts` ＋ `llm-usage.output.ts` ＋ `index.ts`
  - `backend/src/presentation/controllers/llm-usage.controller.ts`
  - `frontend/src/lib/llm-usage.ts`
  - `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/ai-usage/page.tsx`
- 改修:
  - `backend/prisma/schema.prisma`（enum LlmUsageArea + model LlmUsageLog + Project.llmUsageLogs）
  - `backend/src/infrastructure/services/claude.service.ts`（記録の中央集約）
  - `backend/src/infrastructure/services/code-extraction.service.ts`（記録）
  - 呼び出し元（ctx 受け渡し）: requirement.controller / business-flow.controller / issue-tree.controller / generate-kpis.use-case / import-mermaid.use-case / knowledge-ingestion.service /（JobService 経由は各 use-case 側）/ sync.service(→code-extraction)
  - `backend/src/app.module.ts`（providers: LlmUsageRecorder・GetLlmUsageSummaryUseCase / controllers: LlmUsageController）
  - `frontend/src/app/(dashboard)/layout.tsx`（「設定」グループに「AI使用量」追加）
- 再利用（無改変）: `frontend/src/lib/knowledge.ts` の `knowledgeSettingsApi`、`useTableSort`/`SortableTh`、`EditGate`/`useReadOnly`、`PageHeader`。

---

## Task 1: schema — LlmUsageLog モデル＋enum

**Files:** `backend/prisma/schema.prisma`

- [ ] **Step 1: enum と model を追加**（`Project` model 付近、他 model の末尾に追記）

```prisma
enum LlmUsageArea {
  KNOWLEDGE_EXTRACTION
  MERMAID_FLOW
  MERMAID_OBJECT
  KPI
  REQUIREMENT
  ISSUE_SUGGEST
  CODE_EXTRACTION
  OTHER
}

model LlmUsageLog {
  id             String       @id @default(cuid())
  projectId      String       @map("project_id")
  organizationId String?      @map("organization_id")
  userId         String?      @map("user_id")
  area           LlmUsageArea
  model          String
  inputTokens    Int          @default(0) @map("input_tokens")
  outputTokens   Int          @default(0) @map("output_tokens")
  cacheReadInputTokens     Int? @map("cache_read_input_tokens")
  cacheCreationInputTokens Int? @map("cache_creation_input_tokens")
  createdAt      DateTime     @default(now()) @map("created_at")

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId, createdAt])
  @@index([projectId, area])
  @@index([projectId, model])
  @@map("llm_usage_logs")
}
```

- [ ] **Step 2: `Project` model に逆リレーション追加**（他の `xxx[]` 群の近く）

```prisma
  llmUsageLogs LlmUsageLog[]
```

- [ ] **Step 3: db push ＋ generate**

Run:
```
cd backend && npx prisma db push --schema=./prisma/schema.prisma
```
Expected: `Your database is now in sync` ＋ Prisma Client 再生成成功。

- [ ] **Step 4: build**

Run: `cd backend && npm run build`
Expected: 成功（`prisma.llmUsageLog` が型に乗る）。

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma
git commit -m "feat(llm-usage): LlmUsageLog モデル＋LlmUsageArea enum 追加（migration）"
```

---

## Task 2: 単価表＋概算コスト純関数（llm-pricing.ts）

**Files:** Create `backend/src/infrastructure/services/llm-pricing.ts` ＋ Test `backend/src/infrastructure/services/llm-pricing.spec.ts`

> 単価は **USD / 100万トークン（MTok）の概算**。実装時に `claude-api` スキルで最新の正確な値を確認して `MODEL_PRICING` に反映する（下記は代表値）。未知モデルは sonnet 相当にフォールバック。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// backend/src/infrastructure/services/llm-pricing.spec.ts
import { estimateCostUsd, pricingFor } from './llm-pricing';

describe('llm-pricing', () => {
  it('既知モデル(sonnet)の input/output からコストを概算する', () => {
    // sonnet: input $3 / output $15 per MTok を想定
    const cost = estimateCostUsd('claude-sonnet-4-6', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(3 + 15, 4); // 18.0
  });

  it('未知モデルは既定(sonnet)単価にフォールバックして計算する', () => {
    const known = estimateCostUsd('claude-sonnet-4-6', 500_000, 0);
    const unknown = estimateCostUsd('totally-unknown-model', 500_000, 0);
    expect(unknown).toBeCloseTo(known, 6);
  });

  it('cache read/creation トークンも概算に加える（read=入力割引, creation=入力割増）', () => {
    const base = estimateCostUsd('claude-sonnet-4-6', 0, 0);
    const withCache = estimateCostUsd('claude-sonnet-4-6', 0, 0, 1_000_000, 1_000_000);
    expect(withCache).toBeGreaterThan(base);
  });

  it('pricingFor は既知モデルの単価を返す', () => {
    const p = pricingFor('claude-sonnet-4-6');
    expect(p.inputPerMTok).toBeGreaterThan(0);
    expect(p.outputPerMTok).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `cd backend && npx jest llm-pricing`
Expected: FAIL（モジュール未作成）。

- [ ] **Step 3: 実装**

```ts
// backend/src/infrastructure/services/llm-pricing.ts
/**
 * Claude(Anthropic) モデルの概算単価（USD / 100万トークン=MTok）と概算コスト計算。
 *
 * 単価は「概算」。最新の正確な値は claude-api スキル/公式ページで確認して更新すること。
 * 4.x 系は tier 構造（Haiku < Sonnet < Opus）が踏襲される想定で代表値を置く。
 */
export interface ModelPricing {
  /** 入力 USD / MTok。 */
  inputPerMTok: number;
  /** 出力 USD / MTok。 */
  outputPerMTok: number;
}

/** 既定（未知モデルのフォールバック）= Sonnet 相当。 */
const DEFAULT_PRICING: ModelPricing = { inputPerMTok: 3, outputPerMTok: 15 };

/** モデルID（前方一致）→ 単価（2026-06 時点・claude-api スキル準拠）。長いキー優先でマッチ。 */
const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-fable': { inputPerMTok: 10, outputPerMTok: 50 },
  'claude-opus': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku': { inputPerMTok: 1, outputPerMTok: 5 },
};

/** モデルID から単価を引く（前方一致・最長一致優先・未知は既定）。 */
export function pricingFor(model: string): ModelPricing {
  const key = Object.keys(MODEL_PRICING)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? MODEL_PRICING[key] : DEFAULT_PRICING;
}

/**
 * 概算コスト（USD）。cache read は入力の 0.1 倍、cache creation は 1.25 倍で概算する
 * （Anthropic prompt caching の一般的な比率に近い概算。正確値は claude-api 参照）。
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadInputTokens = 0,
  cacheCreationInputTokens = 0,
): number {
  const p = pricingFor(model);
  const input = (inputTokens / 1_000_000) * p.inputPerMTok;
  const output = (outputTokens / 1_000_000) * p.outputPerMTok;
  const cacheRead = (cacheReadInputTokens / 1_000_000) * p.inputPerMTok * 0.1;
  const cacheCreate = (cacheCreationInputTokens / 1_000_000) * p.inputPerMTok * 1.25;
  return input + output + cacheRead + cacheCreate;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd backend && npx jest llm-pricing`
Expected: PASS（4件）。

- [ ] **Step 5: Commit**

```bash
git add backend/src/infrastructure/services/llm-pricing.ts backend/src/infrastructure/services/llm-pricing.spec.ts
git commit -m "feat(llm-usage): モデル別概算単価表＋estimateCostUsd 純関数（+test）"
```

---

## Task 3: LlmUsageRecorder サービス（記録の中央集約）

**Files:** Create `backend/src/infrastructure/services/llm-usage-recorder.service.ts` ＋ Test `...spec.ts`、Modify `backend/src/app.module.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// backend/src/infrastructure/services/llm-usage-recorder.service.spec.ts
import { LlmUsageRecorder } from './llm-usage-recorder.service';

function makePrisma(createImpl?: () => Promise<unknown>) {
  return {
    llmUsageLog: { create: jest.fn(createImpl ?? (async () => ({}))) },
  } as any;
}

describe('LlmUsageRecorder', () => {
  it('usage を llm_usage_logs に1行 insert する（area/model/トークン）', async () => {
    const prisma = makePrisma();
    const rec = new LlmUsageRecorder(prisma);
    await rec.record(
      { projectId: 'p1', area: 'KPI', userId: 'u1' },
      'claude-sonnet-4-6',
      { input_tokens: 100, output_tokens: 50 },
    );
    expect(prisma.llmUsageLog.create).toHaveBeenCalledTimes(1);
    const arg = prisma.llmUsageLog.create.mock.calls[0][0].data;
    expect(arg).toMatchObject({
      projectId: 'p1',
      area: 'KPI',
      userId: 'u1',
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
    });
  });

  it('insert が失敗しても例外を投げない（AI本処理を壊さない）', async () => {
    const prisma = makePrisma(async () => {
      throw new Error('db down');
    });
    const rec = new LlmUsageRecorder(prisma);
    await expect(
      rec.record({ projectId: 'p1', area: 'OTHER' }, 'm', {
        input_tokens: 1,
        output_tokens: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it('projectId が空なら記録しない', async () => {
    const prisma = makePrisma();
    const rec = new LlmUsageRecorder(prisma);
    await rec.record({ projectId: '', area: 'OTHER' }, 'm', {
      input_tokens: 1,
      output_tokens: 1,
    });
    expect(prisma.llmUsageLog.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `cd backend && npx jest llm-usage-recorder`
Expected: FAIL（モジュール未作成）。

- [ ] **Step 3: 実装**

```ts
// backend/src/infrastructure/services/llm-usage-recorder.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../persistence/prisma/prisma.service';

/** どの機能でトークンを使ったか（Prisma enum LlmUsageArea と一致）。 */
export type LlmUsageArea =
  | 'KNOWLEDGE_EXTRACTION'
  | 'MERMAID_FLOW'
  | 'MERMAID_OBJECT'
  | 'KPI'
  | 'REQUIREMENT'
  | 'ISSUE_SUGGEST'
  | 'CODE_EXTRACTION'
  | 'OTHER';

/** 記録に必要なコンテキスト（呼び出し元が渡す）。 */
export interface LlmUsageContext {
  projectId: string;
  area: LlmUsageArea;
  userId?: string | null;
  organizationId?: string | null;
}

/** Anthropic response.usage の最小形（フィールドは snake_case）。 */
export interface AnthropicUsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/**
 * Claude 呼び出しのトークン使用量を llm_usage_logs に記録する中央集約サービス。
 * 記録失敗は AI 本処理を壊さないよう握る（ログのみ）。projectId 不明なら記録しない。
 */
@Injectable()
export class LlmUsageRecorder {
  private readonly logger = new Logger(LlmUsageRecorder.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(
    ctx: LlmUsageContext,
    model: string,
    usage: AnthropicUsageLike | null | undefined,
  ): Promise<void> {
    if (!ctx?.projectId) return;
    try {
      await this.prisma.llmUsageLog.create({
        data: {
          projectId: ctx.projectId,
          organizationId: ctx.organizationId ?? null,
          userId: ctx.userId ?? null,
          area: ctx.area,
          model,
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
          cacheReadInputTokens: usage?.cache_read_input_tokens ?? null,
          cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `LLM使用量の記録に失敗（握り）: project=${ctx.projectId} area=${ctx.area} model=${model}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
```

> 注: `PrismaService` の import パスは既存サービス（例 `code-catalog`/`qstash.service`）と同じ相対パスに合わせること（`../persistence/prisma/prisma.service`）。実ファイルで確認。

- [ ] **Step 4: テストが通ることを確認**

Run: `cd backend && npx jest llm-usage-recorder`
Expected: PASS（3件）。

- [ ] **Step 5: app.module.ts に provider 登録**

`backend/src/app.module.ts` の providers 配列に追加（他 infrastructure サービス登録の近く）:
```ts
    LlmUsageRecorder,
```
import 文も追加:
```ts
import { LlmUsageRecorder } from './infrastructure/services/llm-usage-recorder.service';
```

- [ ] **Step 6: build**

Run: `cd backend && npm run build`
Expected: 成功。

- [ ] **Step 7: Commit**

```bash
git add backend/src/infrastructure/services/llm-usage-recorder.service.ts backend/src/infrastructure/services/llm-usage-recorder.service.spec.ts backend/src/app.module.ts
git commit -m "feat(llm-usage): LlmUsageRecorder（記録の中央集約・失敗握り）＋DI登録（+test）"
```

---

## Task 4: ClaudeService / CodeExtractionService に記録を差し込む＋呼び出し元で ctx を渡す

**Files:** Modify `backend/src/infrastructure/services/claude.service.ts`、`code-extraction.service.ts`、各呼び出し元。

> 方針: 各 AI メソッドに **任意引数 `usage?: LlmUsageContext`** を末尾追加（後方互換）。`messages.create` の戻り値 `response.usage` を `this.usageRecorder.record(usage, <実モデル>, response.usage)` で記録（`usage` が無ければ記録しない）。型で捕まらないため**ライブ smoke で1件記録される**ことを最終確認する（ClaudeService の SDK モックは高コストのため単体テストは付けない）。

- [ ] **Step 1: ClaudeService に recorder を inject ＆ ctx 引数を追加**

`claude.service.ts`:
- import: `import { LlmUsageRecorder, LlmUsageContext } from './llm-usage-recorder.service';`
- コンストラクタに `private readonly usageRecorder: LlmUsageRecorder` を追加（既存 DI の末尾。@Injectable なので自動解決）。
- 各メソッド（parseRequirements/refineRequirement/parseMermaidToFlow/parseMermaidToObjectMap/extractKnowledge/suggestIssueNodes/generateKpis）の引数末尾に `usage?: LlmUsageContext` を追加。
- 各メソッド内、`const response = await client.messages.create({... model: <m> ...})` の直後に:
```ts
    if (usage) await this.usageRecorder.record(usage, <m>, (response as any).usage);
```
（`<m>` は当該呼び出しで実際に使ったモデル変数。`response.usage` は SDK 型に含まれる。型が緩い場合は `(response as any).usage`。）

- [ ] **Step 2: CodeExtractionService にも同様に差し込む**（area は呼び出し元が `CODE_EXTRACTION` を渡す）

`code-extraction.service.ts`:
- recorder を inject、抽出メソッドに `usage?: LlmUsageContext` を追加、`messages.create` 直後に記録。

- [ ] **Step 3: 呼び出し元で ctx を渡す**（各 file を Read して実引数に合わせる）

| 呼び出し元 | area | projectId 取得元 | userId |
|---|---|---|---|
| `requirement.controller.ts`（parse/refine） | `REQUIREMENT` | param/body の projectId | `@CurrentUser().id` |
| `business-flow.controller.ts`（parseMermaidToFlow） | `MERMAID_FLOW` | flow→projectId | CurrentUser |
| `import-mermaid.use-case.ts`（parseMermaidToObjectMap） | `MERMAID_OBJECT` | input.projectId | input.userId? |
| `issue-tree.controller.ts`（suggestIssueNodes） | `ISSUE_SUGGEST` | tree→projectId | CurrentUser |
| `generate-kpis.use-case.ts`（generateKpis） | `KPI` | input.projectId | input.userId? |
| `knowledge-ingestion.service.ts`（extractKnowledge） | `KNOWLEDGE_EXTRACTION` | file.projectId | null可 |
| `sync.service.ts`（CodeExtractionService） | `CODE_EXTRACTION` | connection→projectId | null可 |

各所で `{ projectId, area: '<AREA>', userId }` を該当メソッドの新引数に渡す。projectId/userId が文脈で取れない非同期経路では userId=null 可（projectId は必須なので必ず解決する）。

- [ ] **Step 4: build＋既存テスト緑**

Run: `cd backend && npm run build && npm test`
Expected: build 成功・既存テスト（含む Task2/3 の新規）すべて緑。

- [ ] **Step 5: Commit**

```bash
git add backend/src/infrastructure/services/claude.service.ts backend/src/infrastructure/services/code-extraction.service.ts backend/src/presentation/controllers/requirement.controller.ts backend/src/presentation/controllers/business-flow.controller.ts backend/src/presentation/controllers/issue-tree.controller.ts backend/src/application/use-cases/data-object/import-mermaid.use-case.ts backend/src/application/use-cases/kpi/generate-kpis.use-case.ts backend/src/infrastructure/knowledge/knowledge-ingestion.service.ts backend/src/infrastructure/services/sync.service.ts
git commit -m "feat(llm-usage): 全Claude呼び出しでトークン使用量を記録（領域別ctxを各呼び出し元から渡す）"
```

---

## Task 5: 集計 use-case＋controller（llm-usage スライス）

**Files:** Create `backend/src/application/use-cases/llm-usage/get-llm-usage-summary.use-case.ts`・`llm-usage.output.ts`・`index.ts`・`get-llm-usage-summary.use-case.spec.ts`、`backend/src/presentation/controllers/llm-usage.controller.ts`、Modify `app.module.ts`。

- [ ] **Step 1: output 型を定義**

```ts
// backend/src/application/use-cases/llm-usage/llm-usage.output.ts
import type { LlmUsageArea } from '../../../infrastructure/services/llm-usage-recorder.service';

export interface LlmUsageBucket {
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  costUsd: number;
  count: number;
}
export interface LlmUsageByModel extends LlmUsageBucket { model: string }
export interface LlmUsageByArea extends LlmUsageBucket { area: LlmUsageArea }
export interface LlmUsageRecent {
  id: string;
  area: LlmUsageArea;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: string;
}
export interface LlmUsageSummary {
  period: 'month' | 'all';
  from: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  byModel: LlmUsageByModel[];
  byArea: LlmUsageByArea[];
  recent: LlmUsageRecent[];
}
```

- [ ] **Step 2: 失敗するテストを書く**（prisma と access service をモック）

```ts
// backend/src/application/use-cases/llm-usage/get-llm-usage-summary.use-case.spec.ts
import { GetLlmUsageSummaryUseCase } from './get-llm-usage-summary.use-case';

function makeDeps(rows: any[]) {
  const prisma = {
    llmUsageLog: {
      findMany: jest.fn(async () => rows),
    },
  } as any;
  const access = { assertProjectAccess: jest.fn(async () => undefined) } as any;
  return { prisma, access };
}

const ROWS = [
  { id: 'a', area: 'KPI', model: 'claude-sonnet-4-6', inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: null, cacheCreationInputTokens: null, createdAt: new Date('2026-06-15T00:00:00Z') },
  { id: 'b', area: 'KPI', model: 'claude-sonnet-4-6', inputTokens: 2000, outputTokens: 0, cacheReadInputTokens: null, cacheCreationInputTokens: null, createdAt: new Date('2026-06-15T01:00:00Z') },
  { id: 'c', area: 'KNOWLEDGE_EXTRACTION', model: 'claude-opus-4-8', inputTokens: 100, outputTokens: 100, cacheReadInputTokens: null, cacheCreationInputTokens: null, createdAt: new Date('2026-06-15T02:00:00Z') },
];

describe('GetLlmUsageSummaryUseCase', () => {
  it('byModel/byArea で集計し、合計と概算コストを返す', async () => {
    const { prisma, access } = makeDeps(ROWS);
    const uc = new GetLlmUsageSummaryUseCase(prisma, access);
    const r = await uc.execute({ projectId: 'p1', userId: 'u1', period: 'all' });

    expect(access.assertProjectAccess).toHaveBeenCalled();
    expect(r.totalInputTokens).toBe(3100);
    expect(r.totalOutputTokens).toBe(600);
    expect(r.totalTokens).toBe(3700);
    // model 2種・area 2種に集約
    expect(r.byModel.map((m) => m.model).sort()).toEqual(['claude-opus-4-8', 'claude-sonnet-4-6']);
    expect(r.byArea.map((a) => a.area).sort()).toEqual(['KNOWLEDGE_EXTRACTION', 'KPI']);
    const sonnet = r.byModel.find((m) => m.model === 'claude-sonnet-4-6')!;
    expect(sonnet.count).toBe(2);
    expect(sonnet.inputTokens).toBe(3000);
    expect(sonnet.costUsd).toBeGreaterThan(0);
    expect(r.totalCostUsd).toBeGreaterThan(0);
    expect(r.recent.length).toBe(3);
  });

  it('データ0件でも0集計を返す', async () => {
    const { prisma, access } = makeDeps([]);
    const uc = new GetLlmUsageSummaryUseCase(prisma, access);
    const r = await uc.execute({ projectId: 'p1', userId: 'u1', period: 'month' });
    expect(r.totalTokens).toBe(0);
    expect(r.byModel).toEqual([]);
    expect(r.byArea).toEqual([]);
    expect(r.from).not.toBeNull(); // month は当月初日
  });
});
```

- [ ] **Step 3: テストが落ちることを確認**

Run: `cd backend && npx jest get-llm-usage-summary`
Expected: FAIL（モジュール未作成）。

- [ ] **Step 4: use-case 実装**

```ts
// backend/src/application/use-cases/llm-usage/get-llm-usage-summary.use-case.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import { estimateCostUsd } from '../../../infrastructure/services/llm-pricing';
import type { LlmUsageArea } from '../../../infrastructure/services/llm-usage-recorder.service';
import type {
  LlmUsageSummary,
  LlmUsageByModel,
  LlmUsageByArea,
} from './llm-usage.output';

export interface GetLlmUsageSummaryInput {
  projectId: string;
  userId: string;
  period: 'month' | 'all';
}

interface Row {
  id: string;
  area: LlmUsageArea;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  createdAt: Date;
}

@Injectable()
export class GetLlmUsageSummaryUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async execute(input: GetLlmUsageSummaryInput): Promise<LlmUsageSummary> {
    await this.access.assertProjectAccess(input.projectId, input.userId, 'view');

    const from =
      input.period === 'month'
        ? startOfCurrentMonth()
        : null;

    const rows = (await this.prisma.llmUsageLog.findMany({
      where: {
        projectId: input.projectId,
        ...(from ? { createdAt: { gte: from } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    })) as unknown as Row[];

    const cost = (r: Row) =>
      estimateCostUsd(
        r.model,
        r.inputTokens,
        r.outputTokens,
        r.cacheReadInputTokens ?? 0,
        r.cacheCreationInputTokens ?? 0,
      );

    const byModelMap = new Map<string, LlmUsageByModel>();
    const byAreaMap = new Map<LlmUsageArea, LlmUsageByArea>();
    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;

    for (const r of rows) {
      const c = cost(r);
      totalInput += r.inputTokens;
      totalOutput += r.outputTokens;
      totalCost += c;

      const m =
        byModelMap.get(r.model) ??
        { model: r.model, inputTokens: 0, outputTokens: 0, tokens: 0, costUsd: 0, count: 0 };
      m.inputTokens += r.inputTokens;
      m.outputTokens += r.outputTokens;
      m.tokens += r.inputTokens + r.outputTokens;
      m.costUsd += c;
      m.count += 1;
      byModelMap.set(r.model, m);

      const a =
        byAreaMap.get(r.area) ??
        { area: r.area, inputTokens: 0, outputTokens: 0, tokens: 0, costUsd: 0, count: 0 };
      a.inputTokens += r.inputTokens;
      a.outputTokens += r.outputTokens;
      a.tokens += r.inputTokens + r.outputTokens;
      a.costUsd += c;
      a.count += 1;
      byAreaMap.set(r.area, a);
    }

    const round = (n: number) => Math.round(n * 10000) / 10000;
    const finalizeModel = (b: LlmUsageByModel) => ({ ...b, costUsd: round(b.costUsd) });
    const finalizeArea = (b: LlmUsageByArea) => ({ ...b, costUsd: round(b.costUsd) });

    return {
      period: input.period,
      from: from ? from.toISOString() : null,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalTokens: totalInput + totalOutput,
      totalCostUsd: round(totalCost),
      byModel: Array.from(byModelMap.values()).map(finalizeModel).sort((x, y) => y.tokens - x.tokens),
      byArea: Array.from(byAreaMap.values()).map(finalizeArea).sort((x, y) => y.tokens - x.tokens),
      recent: rows.slice(0, 20).map((r) => ({
        id: r.id,
        area: r.area,
        model: r.model,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUsd: round(cost(r)),
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}

/** 当月初日（UTC）。 */
function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
```

```ts
// backend/src/application/use-cases/llm-usage/index.ts
export * from './get-llm-usage-summary.use-case';
export * from './llm-usage.output';
```

> `ProjectAccessService.assertProjectAccess(projectId, userId, 'view'|'edit')` の実シグネチャを Read して合わせること（既存 use-case の使い方に倣う）。

- [ ] **Step 5: テストが通ることを確認**

Run: `cd backend && npx jest get-llm-usage-summary`
Expected: PASS（2件）。

- [ ] **Step 6: controller 実装**

```ts
// backend/src/presentation/controllers/llm-usage.controller.ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetLlmUsageSummaryUseCase } from '../../application/use-cases/llm-usage';
import { CurrentUser, CurrentUserPayload } from '../decorators';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

@ApiTags('AI使用量')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller()
export class LlmUsageController {
  constructor(private readonly getSummary: GetLlmUsageSummaryUseCase) {}

  @Get('projects/:projectId/llm-usage')
  @ApiOperation({ summary: 'プロジェクトのAI使用量サマリ（モデル別/領域別/概算コスト）' })
  async summary(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Query('period') period?: string,
  ) {
    return this.getSummary.execute({
      projectId,
      userId: user.id,
      period: period === 'all' ? 'all' : 'month',
    });
  }
}
```

> `ProjectScopedAccess`/`ProjectAccessGuard`/`CurrentUser` の import 元は既存 controller（例 tracker-webhook.controller.ts）に合わせる。

- [ ] **Step 7: app.module.ts に登録**

- import:
```ts
import { GetLlmUsageSummaryUseCase } from './application/use-cases/llm-usage';
import { LlmUsageController } from './presentation/controllers/llm-usage.controller';
```
- providers 配列に `GetLlmUsageSummaryUseCase,`
- controllers 配列に `LlmUsageController,`

- [ ] **Step 8: build＋テスト緑**

Run: `cd backend && npm run build && npm test`
Expected: 成功・全緑。

- [ ] **Step 9: Commit**

```bash
git add backend/src/application/use-cases/llm-usage backend/src/presentation/controllers/llm-usage.controller.ts backend/src/app.module.ts
git commit -m "feat(llm-usage): 使用量サマリ集計 use-case＋GET /projects/:id/llm-usage（+test）"
```

---

## Task 6: フロント — lib＋「AI使用量」ページ＋サイドバー

**Files:** Create `frontend/src/lib/llm-usage.ts`・`frontend/src/app/(dashboard)/dashboard/projects/[projectId]/ai-usage/page.tsx`、Modify `frontend/src/app/(dashboard)/layout.tsx`。

- [ ] **Step 1: lib/llm-usage.ts（API クライアント＋型＋領域ラベル）**

```ts
// frontend/src/lib/llm-usage.ts
// AI使用量サマリ API。raw fetch + localStorage 'accessToken'（既存 lib 慣習）。
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

export type LlmUsageArea =
  | 'KNOWLEDGE_EXTRACTION'
  | 'MERMAID_FLOW'
  | 'MERMAID_OBJECT'
  | 'KPI'
  | 'REQUIREMENT'
  | 'ISSUE_SUGGEST'
  | 'CODE_EXTRACTION'
  | 'OTHER';

export const AREA_LABEL: Record<LlmUsageArea, string> = {
  KNOWLEDGE_EXTRACTION: 'ナレッジ抽出',
  MERMAID_FLOW: 'Mermaid→業務フロー',
  MERMAID_OBJECT: 'Mermaid→オブジェクト図',
  KPI: 'KPI生成',
  REQUIREMENT: '要求定義',
  ISSUE_SUGGEST: 'イシューツリー候補',
  CODE_EXTRACTION: 'コード/スキーマ解析',
  OTHER: 'その他',
};

export interface LlmUsageBucket {
  inputTokens: number; outputTokens: number; tokens: number; costUsd: number; count: number;
}
export interface LlmUsageByModel extends LlmUsageBucket { model: string }
export interface LlmUsageByArea extends LlmUsageBucket { area: LlmUsageArea }
export interface LlmUsageRecent {
  id: string; area: LlmUsageArea; model: string;
  inputTokens: number; outputTokens: number; costUsd: number; createdAt: string;
}
export interface LlmUsageSummary {
  period: 'month' | 'all';
  from: string | null;
  totalInputTokens: number; totalOutputTokens: number; totalTokens: number; totalCostUsd: number;
  byModel: LlmUsageByModel[]; byArea: LlmUsageByArea[]; recent: LlmUsageRecent[];
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

export const llmUsageApi = {
  async getSummary(projectId: string, period: 'month' | 'all'): Promise<LlmUsageSummary> {
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/llm-usage?period=${period}`,
      { headers: headers() },
    );
    if (!res.ok) throw new Error('AI使用量の取得に失敗しました');
    return res.json() as Promise<LlmUsageSummary>;
  },
};

/** トークン数を人間可読に（1,234 / 12.3K / 1.2M）。 */
export function formatTokens(n: number): string {
  if (n < 1000) return n.toLocaleString('en-US');
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** 概算コスト（USD）表示。 */
export function formatUsd(n: number): string {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}
```

- [ ] **Step 2: ページ実装**（ダッシュボード＋設定パネル）

`frontend/src/app/(dashboard)/dashboard/projects/[projectId]/ai-usage/page.tsx`:
- `'use client'`。`useParams` で projectId。
- state: `summary`, `period('month'|'all')`, `loading`, `error`、`settings`(ProjectKnowledgeSettings)。
- 取得: `llmUsageApi.getSummary(projectId, period)` を period 変更で再取得。`knowledgeSettingsApi.get(projectId)` を初回取得。
- レイアウト:
  - `PageHeader`（title「AI使用量」, description「Claude のトークン使用量と概算コスト（プロジェクト単位）」, actions=期間トグル `今月 / 全期間`）。
  - 合計カード4枚（入力トークン `formatTokens` / 出力トークン / 合計 / 概算コスト `formatUsd`）。「コストは概算」注記。
  - モデル別テーブル（列: モデル / 入力 / 出力 / 合計 / 概算コスト / 回数）。
  - 機能領域別テーブル（列: 領域=`AREA_LABEL[area]` / 入力 / 出力 / 合計 / コスト / 回数）。
  - 直近の呼び出し（`recent`）リスト（領域・モデル・in/out・コスト・時刻）。空なら「まだ記録がありません」。
  - 下段「設定」カード（`EditGate`）: AI抽出 toggle / OCR toggle / モデル select（サーバ既定/sonnet/opus）/ imagingMode select(auto/always/never) / 最大ファイル数 input → `knowledgeSettingsApi.update(projectId, {...})`（onBlur or 保存ボタン）。`useReadOnly().canEdit` で抑止。
- スタイル/コンポーネントは既存ページ（例 `risk-management`/`catalog`）に合わせる（Card/Button/Select/Input/`useTableSort`+`SortableTh` を流用）。

> 既存 import 例: `import { knowledgeSettingsApi, type ProjectKnowledgeSettings } from '@/lib/knowledge'`、`import { useReadOnly } from '@/components/read-only-context'`、`import { EditGate } from '@/components/edit-gate'`、`import { PageHeader } from '@/components/ui/page-header'`。

- [ ] **Step 3: サイドバーに項目追加**

`frontend/src/app/(dashboard)/layout.tsx` の「設定」グループ（`label: '設定'`）の items 先頭付近に追加:
```ts
          { name: 'AI使用量', href: `${base}/ai-usage`, icon: BarChart3 },
```
`BarChart3` を `lucide-react` の import に追加（未 import の場合）。

- [ ] **Step 4: tsc＋vitest＋build**

Run:
```
cd frontend && npx tsc --noEmit && npm test && npm run build
```
Expected: tsc 0・vitest 緑・build 成功（ルート `/dashboard/projects/[projectId]/ai-usage` 出力）。

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/lib/llm-usage.ts" "frontend/src/app/(dashboard)/dashboard/projects/[projectId]/ai-usage/page.tsx" "frontend/src/app/(dashboard)/layout.tsx"
git commit -m "feat(llm-usage): 「AI使用量」ページ（モデル別/領域別/概算コスト＋設定パネル）＋サイドバー"
```

---

## Task 7: 最終検証＋ライブ smoke

- [ ] **Step 1: backend 全テスト＋build**

Run: `cd backend && npm test && npm run build`
Expected: 全緑・build 成功。

- [ ] **Step 2: frontend tsc＋vitest＋build**

Run: `cd frontend && npx tsc --noEmit && npm test && npm run build`
Expected: tsc 0・vitest 緑・build 成功。

- [ ] **Step 3: ライブ smoke（記録→集計）**

前提: backend watch 再起動（schema 反映）。AI 機能を1回実行（例: KPI生成 or イシューツリーAI候補 or mermaid取込。Anthropic キーが backend/.env にある前提）。その後:
```
TOKEN=<demoでログインして得た accessToken>
PID=<対象 projectId>
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:5021/api/projects/$PID/llm-usage?period=all" | head -c 600
```
Expected: `totalTokens > 0`、`byModel`/`byArea` に1件以上、`recent` に記録。AI 機能が叩けない場合は `llm_usage_logs` に手動1行 insert（psql）して集計200・形を確認。

- [ ] **Step 4: 受け入れ確認**
  1. 全 Claude 呼び出し経路（KPI/イシューツリー/mermaid/ナレッジ抽出/要求定義/コード解析）で記録される（ctx を渡した箇所）。
  2. `GET /api/projects/:id/llm-usage?period=month|all` がモデル別/領域別/概算コスト/直近を返す。
  3. 「AI使用量」ページがサイドバー「設定」群に出て、合計・モデル別・領域別・直近・設定パネルを表示。
  4. 設定パネルから AI抽出/OCR/モデル を保存でき、NewBatchDialog の初期値に反映。
  5. backend test/build・frontend tsc/vitest/build 緑。

- [ ] **Step 5: 最終コミット確認**（各タスクで commit 済み。未コミット差分が無いこと）

Run: `git status --porcelain`
Expected: 空。

---

## 自己レビュー（writing-plans）

- **スペック網羅:** モデル=T1 / 単価=T2 / 記録=T3-T4 / 集計API=T5 / フロント＆設定=T6 / 検証=T7。スペックの A–F 全カバー。
- **プレースホルダ:** 単価の正確値のみ「実装時に claude-api で確認」（代表値は記載済み＝具体コードあり）。他に TBD なし。
- **型整合:** `LlmUsageContext`/`LlmUsageArea`（recorder で定義 → use-case/output/controller/lib で一致）、`LlmUsageSummary` の形は backend output と frontend lib で一致、`estimateCostUsd`/`pricingFor` 命名一貫、`assertProjectAccess(projectId,userId,'view')` の実シグネチャは実装時に確認の注記あり。
- **スコープ:** 単一プランに収まる（予算上限・会社横断・¥換算はスコープ外）。
