# AI使用量の記録・可視化・プロジェクト設定 — 設計（Design Spec）

作成日: 2026-06-15 / ブランチ: feat/methodology-pipeline

## 背景・目的

ナレッジ取り込みの「抽出オプション（AI抽出・OCR・モデル）」がバッチ作成ダイアログにしか無く、かつ Claude(Anthropic) の **トークン使用量がどこにも記録されていない**。本機能で次を実現する:

1. **すべての Claude プロンプト使用量を記録**（モデル別・機能領域別に input/output トークン）。
2. **左サイドメニューに「AI使用量」ページ**を新設し、モデル別・機能領域別のトークン使用量＋概算コストを可視化。
3. **AI抽出/OCR/モデルの設定**（既存 ProjectKnowledgeSettings）を同ページから編集できるようにする。

要件確定（AskUserQuestion）: 領域=**機能領域別** / 設定粒度=**プロジェクト単位** / ダッシュボード集計範囲=**プロジェクト単位** / コスト=**トークン＋概算コスト**。

## 現状アーキテクチャ（調査結果の要点）

- Claude 呼び出しは `backend/src/infrastructure/services/claude.service.ts`（8メソッド、すべて `client.messages.create`）にほぼ一元化。加えて独立した `backend/src/infrastructure/services/code-extraction.service.ts`（GitHubコード解析）が直接 `messages.create`。
- `response.usage`(input_tokens/output_tokens) は**現在どこにも参照・記録されていない**。使用量モデルは存在しない。
- APIキー解決＝`CompanyKeyService`（Organization鍵 → User鍵 → env）。課金境界＝**Organization**。
- 既存設定 `ProjectKnowledgeSettings`（projectId @unique, aiExtractionEnabled / ocrEnabled / defaultModel / imagingMode / maxFilesPerBatch）。GET/PUT `/api/projects/:id/knowledge/settings`。
- 非同期AIは QStash → `JobService.runJob` → dispatch（AI_MERMAID_FLOW / AI_ISSUE_SUGGEST / AI_KPI / AI_MERMAID_OBJECTMAP / KG_INGEST_FILE）。すべて最終的に ClaudeService を呼ぶ。

## 機能領域（area）の分類

`LlmUsageArea`（コード定数 ↔ 表示ラベル）:

| enum値 | ラベル | 発生元 |
|---|---|---|
| `KNOWLEDGE_EXTRACTION` | ナレッジ抽出 | ClaudeService.extractKnowledge（KnowledgeIngestionService） |
| `MERMAID_FLOW` | Mermaid→業務フロー | ClaudeService.parseMermaidToFlow（ImportMermaid/Job） |
| `MERMAID_OBJECT` | Mermaid→オブジェクト図 | ClaudeService.parseMermaidToObjectMap |
| `KPI` | KPI生成 | ClaudeService.generateKpis |
| `REQUIREMENT` | 要求定義 | ClaudeService.parseRequirements / refineRequirement |
| `ISSUE_SUGGEST` | イシューツリー候補 | ClaudeService.suggestIssueNodes |
| `CODE_EXTRACTION` | コード/スキーマ解析 | CodeExtractionService |
| `OTHER` | その他 | 未分類フォールバック |

UserSettingsController のAPIキー検証 ping は **記録しない**（projectId が無く、トークンも微小）。

## アーキテクチャ / コンポーネント

### A. データモデル（新規 `LlmUsageLog`・完全 additive）

`backend/prisma/schema.prisma`:

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
  organizationId String?      @map("organization_id") // 課金境界での集計用（解決できれば）
  userId         String?      @map("user_id")         // 起票ユーザー（任意）
  area           LlmUsageArea
  model          String       // 実際に呼んだモデルID（例 claude-sonnet-4-6）
  inputTokens    Int          @default(0) @map("input_tokens")
  outputTokens   Int          @default(0) @map("output_tokens")
  cacheReadInputTokens     Int? @map("cache_read_input_tokens")     // 取得できれば（概算精度向上）
  cacheCreationInputTokens Int? @map("cache_creation_input_tokens")
  createdAt      DateTime     @default(now()) @map("created_at")

  project      Project       @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId, createdAt])
  @@index([projectId, area])
  @@index([projectId, model])
  @@map("llm_usage_logs")
}
```

`Project` に `llmUsageLogs LlmUsageLog[]` を追加。`prisma db push`（additive）。

### B. 記録機構（中央集約）

新サービス `backend/src/infrastructure/services/llm-usage-recorder.service.ts`:

- `record(ctx, model, usage)` を提供。`ctx = { projectId; area; userId?; organizationId? }`、`usage = response.usage`（`input_tokens`/`output_tokens`/`cache_read_input_tokens?`/`cache_creation_input_tokens?`）。
- 内部で PrismaService により `llm_usage_logs` に1行 insert。
- **try/catch で握り、AI 本処理を絶対に壊さない**（記録失敗はログのみ）。await はするが失敗は無害化。
- `projectId` が無い呼び出し（キー検証など）は呼ばない＝記録しない。

`ClaudeService` 改修:
- コンストラクタに `LlmUsageRecorder` を inject。
- 各メソッドに **任意引数 `usage?: LlmUsageContext`** を追加（後方互換。省略時は記録しない）。
- 各 `messages.create` の戻り値 `response.usage` を `recorder.record(usage, 使用モデル, response.usage)` で記録（area は呼び出し元が ctx に入れて渡す。`model` は実際に使った値）。

`CodeExtractionService` も同様に inject ＆ 記録（area=`CODE_EXTRACTION`）。

呼び出し元の最小修正（area＋projectId＋userId を ctx として渡す）:
- RequirementController（REQUIREMENT, projectId, user.id）
- BusinessFlowController / ImportMermaidUseCase（MERMAID_FLOW / MERMAID_OBJECT）
- IssueTreeController（ISSUE_SUGGEST）
- GenerateKpisUseCase（KPI）
- KnowledgeIngestionService.processFile（KNOWLEDGE_EXTRACTION）
- JobService.dispatch 経由の非同期も、各 use-case/service が ctx を持つので同経路でカバー。
- SyncService → CodeExtractionService（CODE_EXTRACTION）

userId は取れる箇所のみ（非同期ジョブで取れなければ null）。organizationId は CompanyKeyService 解決時に分かる範囲で（取れなければ null。MVPでは null 許容）。

### C. 集計API（新クリーンアーキスライス `llm-usage`）

- `GetLlmUsageSummaryUseCase`（assertProjectAccess(view)）。
- エンドポイント `GET /api/projects/:projectId/llm-usage?period=month|all`（既定 month=当月1日〜現在）。
- レスポンス契約:

```ts
interface LlmUsageSummary {
  period: 'month' | 'all'
  from: string | null            // ISO（month のとき当月初日、all は null）
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  totalCostUsd: number           // 概算
  byModel: Array<{ model: string; inputTokens: number; outputTokens: number; tokens: number; costUsd: number; count: number }>
  byArea: Array<{ area: LlmUsageArea; inputTokens: number; outputTokens: number; tokens: number; costUsd: number; count: number }>
  recent: Array<{ id: string; area: LlmUsageArea; model: string; inputTokens: number; outputTokens: number; costUsd: number; createdAt: string }> // 直近N=20
}
```

- 集計は Prisma `groupBy`（model / area）＋ recent は `findMany`(take20, desc)。コストは下記単価表で計算。

### D. 概算コスト（モデル別単価表）

`backend/src/infrastructure/services/llm-pricing.ts`（純関数＋定数）:
- `MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }>`（USD / 100万トークン）。対象: claude-opus-4-x, claude-sonnet-4-6, claude-haiku-4-5 等。
- `estimateCostUsd(model, inputTokens, outputTokens, cacheRead?, cacheCreation?): number`。cache はあれば概算反映（read は入力割引、creation は割増）。
- **単価は「概算」**。未知モデルは最も近い既定（sonnet）にフォールバックし `costUsd` は計算しつつ UI で「概算」明示。
- 実装時に `claude-api` スキルで最新の正確な $/MTok を確認して定数に反映する。

通貨は **USD 表示**（必要なら将来 ¥ 換算を足す。MVPは $ のみ・小数2桁）。

### E. 設定（既存 ProjectKnowledgeSettings 再利用・backend 変更なし）

新ページ下段の設定パネルが既存 `knowledgeSettingsApi.get/update`（GET/PUT `/api/projects/:id/knowledge/settings`）で `aiExtractionEnabled / ocrEnabled / defaultModel / imagingMode / maxFilesPerBatch` を編集。NewBatchDialog はこれを初期値に使い続ける（既存挙動維持）。

### F. フロント新ページ「AI使用量」

- ルート: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/ai-usage/page.tsx`。
- サイドバー（`layout.tsx`）の **「設定」グループ**に項目「AI使用量」を追加（アイコン例: `BarChart3` / `Activity`）。
- lib: `frontend/src/lib/llm-usage.ts`（`llmUsageApi.getSummary(projectId, period)`、raw fetch + localStorage 'accessToken' 慣習）。
- 画面構成:
  1. 期間トグル（今月 / 全期間）。
  2. 合計カード: 入力 / 出力 / 合計トークン / 概算コスト($)。
  3. **モデル別テーブル**（model・in・out・合計・概算コスト・回数、`useTableSort` 適用）。
  4. **機能領域別テーブル**（領域ラベル・in・out・合計・コスト・回数）。
  5. 直近の呼び出し一覧（領域・モデル・in/out・コスト・時刻）。
  6. 下段 **設定パネル**（AI抽出/OCR トグル・モデル select・imagingMode・最大ファイル数）＝既存 knowledgeSettingsApi.update。
- 読取専用ユーザーは設定パネルを EditGate で抑止（ダッシュボードは閲覧可）。

## データフロー

1. 任意のAI機能が ClaudeService/CodeExtractionService を ctx 付きで呼ぶ → messages.create → `response.usage` を LlmUsageRecorder が `llm_usage_logs` に1行記録（失敗は握る）。
2. ユーザーが「AI使用量」ページを開く → `GET /llm-usage?period=` → groupBy 集計＋単価計算 → 画面に表示。
3. 設定パネル保存 → 既存 PUT /knowledge/settings → 以後のバッチ/抽出に反映。

## エラーハンドリング

- 記録失敗は AI 本処理に影響させない（try/catch・ログのみ）。
- 集計APIは assertProjectAccess。データ0件でも空集計（0）を返す。
- 未知モデルの単価は近似フォールバック＋UIで「概算」を明示。

## テスト

- backend jest:
  - `llm-pricing` 純関数（既知/未知モデル・cache 有無のコスト計算）。
  - `LlmUsageRecorder.record`（insert 呼び出し・例外を握る）。
  - `GetLlmUsageSummaryUseCase`（byModel/byArea 集計・コスト合算・period フィルタ）。
- frontend: lib/llm-usage の最小型テスト（任意）、tsc/vitest/build。
- ライブ smoke: AI機能を1回叩く→ `GET /llm-usage` に1件以上反映（200）。

## スコープ外（YAGNI）

- 予算上限/超過アラート・課金停止。
- 会社(Organization)横断/システム全体ダッシュボード（今回はプロジェクト単位のみ。organizationId は将来集計用に記録だけする）。
- ¥換算・為替。
- リアルタイム更新（ページ読込時取得のみ）。

## 影響ファイル（想定）

- 追加: schema（LlmUsageLog + enum）、`infrastructure/services/llm-usage-recorder.service.ts`、`infrastructure/services/llm-pricing.ts`、`application/use-cases/llm-usage/*`、`presentation/controllers/llm-usage.controller.ts`、frontend `lib/llm-usage.ts` ＋ `ai-usage/page.tsx`。
- 改修: `claude.service.ts`・`code-extraction.service.ts`（記録）、各呼び出し元（ctx 受け渡し）、`app.module.ts`（DI/controller 登録）、`layout.tsx`（サイドバー）。
- 再利用（無改変）: `knowledgeSettingsApi` / `/knowledge/settings`。
