# brain-pro AIゲートウェイ（ipro-bot連携）設計

- 日付: 2026-07-11
- ステータス: 設計承認済み
- 関連: `2026-06-14-project-understanding-sync-design.md`（ipro-bot→Brain Pro 理解ノート同期。P2で本設計と合流し `project_ai_data_flow_links` を共有する）

## 1. 背景・目的

Brain Pro のAI機能（要求定義変換 / Mermaid取込 / ナレッジ抽出 / 課題提案 / KPI生成 / Excelタスク取込 / コード抽出 / 充実度診断）は、現在 `ClaudeService` から Anthropic API を直接呼んでいる。一方 ipro-bot には以下が既に揃っている:

- **IPLoT頭脳**: ipro-kun の method.md を vendor 同梱し、intent別に system prompt へ注入（`src/core/methodology.ts` `loadMethod`）
- **AI予算ガード**: 会社別の日次コスト上限（`src/lib/ai-budget.ts` `enforceAiBudget`）
- **モデル解決**: 会社別 → システム既定 → env の3段フォールバック（`src/core/claude.ts` `resolveDefaultModel`）
- **外部API認証パターン**: directory API の Bearer トークン（sha256ハッシュ保存・会社スコープ・失効可能、`src/lib/directory-auth.ts`）

本設計のゴールは、**Brain Pro のAI呼び出しを ipro-bot 経由に切り替え可能にする**こと。これにより (1) APIキーとコスト管理の一元化、(2) IPLoT頭脳の全AI機能への注入、(3) 将来のプロジェクト文脈（Slack由来のRAG/理解）注入への土台、を得る。

## 2. スコープ

**IN（P1）**
- ipro-bot: `POST /api/ai/run`（パススルー実行＋頭脳注入）、`GET /api/ai/health`（接続テスト）、`ai_gateway_tokens` 認証、予算ガード、usage記録
- Brain Pro: `ClaudeService` 内部の `LlmTransport` 抽象化（Anthropic直 / ipro-bot経由の2実装）、組織単位の接続設定 `IproBotConnection`（暗号化保存＋管理UI＋接続テスト）、自動フォールバック
- 既存AI 9機能すべてがゲートウェイ経由で動作すること（呼び出し元は無改修）

**OUT（将来フェーズ）**
- P2: プロジェクト文脈注入（`project_ai_data_flow_links` の整備＝理解ノート同期スペックと合流）
- P3: 双方向連携（ipro-bot から Brain Pro の構造化成果物を生成）、Structured Outputs のゲートウェイ対応

## 3. アーキテクチャ

```
Brain Pro AI 9機能（呼び出し元は無改修）
   ▼
ClaudeService（公開メソッドのシグネチャ不変）
   └─ LlmTransport.run(req) に内部を集約
        ├─ AnthropicTransport …… 現行の client.messages.create（連携OFF時・フォールバック時）
        └─ IproBotTransport …… POST {baseUrl}/api/ai/run (Authorization: Bearer aig_...)
                                     │
                             [ipro-bot] /api/ai/run（maxDuration: 300）
                                ├─ ① トークン認証（ai_gateway_tokens: sha256照合・会社スコープ解決）
                                ├─ ② enforceAiBudget(companyId) → 超過は 429
                                ├─ ③ 頭脳注入: taskType→method.md マップがあれば system 先頭に
                                │     cache_control(1h) 付きブロックとして追加
                                ├─ ④ client.messages.create（プレーン実行。P1はStructured Outputs不使用）
                                ├─ ⑤ recordModelUsage(model, `brain-pro:${taskType}`, usage)
                                │     ※ withCompanyUsage(companyId) で会社帰属
                                └─ ⑥ { text, usage, model } を返却
   ▼
Brain Pro は応答テキストを従来どおり自前でJSONパースし、LlmUsageLog に記録（現行の課金ガードも不変）
```

設計の根拠: Brain Pro の全AIメソッドは「system＋messages → テキスト応答 → 自前のJSON抽出」で完結しているため、ゲートウェイは **テキストのパススルー** で十分。ipro-bot 側の zod/Structured Outputs（`runStructured`）はゲートウェイでは使わない（P3で検討）。

## 4. API仕様（ipro-bot側）

### POST /api/ai/run

リクエスト:
```jsonc
{
  "taskType": "KNOWLEDGE_EXTRACTION",   // Brain Pro の LlmUsageArea 値
  "model": "claude-sonnet-4-6",         // 任意。省略/不正時は resolveDefaultModel()
  "system": "...",                       // Brain Pro が組んだ system prompt
  "messages": [{ "role": "user", "content": "..." }],  // Anthropic MessageParam[] 互換
  "maxTokens": 8192,                     // 任意。既定 8192
  "projectRef": {                        // 任意。P1ではログ用途のみ、P2で文脈注入キー
    "adfOrganizationId": "...",
    "adfProjectId": "..."
  }
}
```

応答（200）:
```jsonc
{
  "text": "...",                         // 最初の text ブロック連結
  "model": "claude-sonnet-4-6",          // 実際に使ったモデル
  "usage": { "inputTokens": 0, "outputTokens": 0, "cacheCreationInputTokens": 0, "cacheReadInputTokens": 0 }
}
```

エラー: 401（トークン無効）/ 429（予算超過。body に `{ "error": "budget_exceeded" }`）/ 400（payload不正）/ 502（Anthropic呼び出し失敗）。

### GET /api/ai/health

Bearer 認証のみ検証し `{ "ok": true, "companyId": "..." }` を返す。Brain Pro 管理UIの「接続テスト」が叩く。

### 頭脳注入の合成規則

system は Anthropic のブロック配列に変換する: `[ method.md（taskTypeマップにヒットした場合。cache_control: ephemeral 1h）, Brain Pro が送った system ]`。マップにない taskType（例: MERMAID_FLOW のような構文パースは頭脳不要）は素通し。マップは ipro-bot 側のコード内定数（`taskType → vendor/ipro-method/<skill>/method.md`）とし、初期対応は ISSUE_SUGGEST / KPI / REQUIREMENT / KNOWLEDGE_EXTRACTION / OTHER(充実度診断) のうち該当スキルが存在するもののみ。空文字ブロックは入れない（Anthropic が 400 で弾くため。`runStructured` と同じ注意）。

## 5. データモデル

### ipro-bot（Drizzle, `src/db/schema.ts`）

directory-tokens と同型の専用トークンテーブル:
```ts
export const aiGatewayTokens = pgTable("ai_gateway_tokens", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  prefix: text("prefix").notNull(),          // aig_XXXXXXXX（表示用）
  label: text("label"),                       // 用途メモ（例: brain-pro本番）
  revokedAt: timestamp("revoked_at"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ ux: uniqueIndex("aigt_token_hash_ux").on(t.tokenHash) }));
```
- 平文は `aig_` + base64url(32byte)。発行時に1回だけ表示、保存はハッシュのみ（directory-auth の `generateToken` パターンを流用）。
- 発行導線は directory トークンと同じ管理面（管理スクリプト or 既存管理UIへの追加）。

### Brain Pro（Prisma, `backend/prisma/schema.prisma`）

```prisma
model IproBotConnection {
  id             String   @id @default(cuid())
  organizationId String   @unique
  baseUrl        String                      // 例 https://ipro-bot.example.com
  apiTokenEnc    String                      // aig_ トークンをAES-256-GCM暗号化（既存の暗号化ユーティリティ/ソルトを流用）
  enabled        Boolean  @default(true)
  strict         Boolean  @default(false)    // true: フォールバック禁止（障害時はエラー）
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
}
```
- 組織単位（1組織1接続）。env フォールバック `IPRO_BOT_URL` / `IPRO_BOT_API_TOKEN`（全組織共通のセルフホスト向け。DB設定が優先）。

## 6. Brain Pro 側の内部変更

- `LlmTransport` インターフェイス: `run(req: { model: string; system: string; messages: MessageParam[]; maxTokens: number; taskType: LlmUsageArea; projectRef?: {...} }): Promise<{ text: string; model: string; usage: NormalizedUsage }>`
- `AnthropicTransport`: 現行の `getClient(apiKey).messages.create` を移設。応答から text 抽出まで担当。
- `IproBotTransport`: 上記APIへの薄い fetch ラッパ（タイムアウト 240s、リトライなし＝リトライは呼び出し元ジョブ基盤の責務）。
- `LlmTransportResolver`: 呼び出しコンテキストの organizationId（`LlmUsageContext` の projectId から導出。組織が特定できない呼び出しは直接Anthropic）→ `IproBotConnection`（無ければ env）→ enabled なら `IproBotTransport`、それ以外は `AnthropicTransport`。
- `ClaudeService` の9メソッド: プロンプト構築とJSONパースはそのまま、`client.messages.create` 部分だけ `transport.run(...)` に置換。usage記録は transport の戻り値で従来どおり `usageRecorder.record(...)`。
- **フォールバック**: `IproBotTransport` が失敗（ネットワーク断 / 5xx / 429予算超過）したとき、`strict=false` なら `AnthropicTransport` で再実行して warn ログ（`ANTHROPIC_API_KEY` 未設定ならそのままエラー）。`strict=true` なら即エラー。401（トークン無効）は設定ミスなのでフォールバックせずエラーにして気づかせる。
- **管理UI**: 会社設定ページに「ipro-bot連携」パネル（baseUrl / トークン入力（書き込み専用・再表示しない）/ enabled / strict / 接続テストボタン）。API は組織管理者権限（OWNER/ADMIN）のみ。

## 7. エラー処理・運用

- ゲートウェイ429（予算超過）はフォールバック対象（Brain Pro 側の課金ガード `ProjectKnowledgeSettings` は従来どおり効く）。フォールバック発生は warn ログ＋（将来）管理画面での可視化。
- ipro-bot 側は Anthropic エラーを 502 に正規化し、Anthropic のエラーメッセージを body に含める（Brain Pro のログで原因追跡できるように）。
- トークンは `lastUsedAt` を touch（fire-and-forget）し、監査に使う。

## 8. テスト

- **ipro-bot**（vitest、外部依存モック・ネットワーク不要）: 認証分岐（無効/失効/欠落→401）、予算超過→429、頭脳注入の有無（マップ有/無/空method）、system ブロック合成順、usage記録の会社帰属、health。
- **Brain Pro**（jest、既存142テストの回帰込み）: Resolver の分岐（DB設定/env/無設定）、フォールバック挙動（5xx→直接再実行 / strict→エラー / 401→フォールバックしない）、`IproBotConnection` CRUD＋暗号化ラウンドトリップ、transport 差し替え後の各AIメソッドの出力互換（モックtransport）。

## 9. フェーズ

- **P1（本設計の実装範囲）**: 上記すべて。既存AI 9機能がゲートウェイ経由で動作。
- **P2**: `projectRef` を使ったプロジェクト文脈注入。ipro-bot 側で `project_ai_data_flow_links` を逆引きし、`project_memory` + `project_context(auto)` の要約を system に追加注入。links テーブルと初回リンク確立は理解ノート同期スペック（2026-06-14）の実装と共有。
- **P3**: 双方向（ipro-bot → Brain Pro 構造化成果物生成）、Structured Outputs パススルー、フォールバック発生の管理ダッシュボード。

## 10. 依存・前提

- ipro-bot のデプロイURL に Brain Pro バックエンド（Vercel）から到達できること。
- 暗号化は Brain Pro 既存の暗号化ユーティリティ（AES-256-GCM＋環境変数ソルト）を流用。新しい鍵管理は導入しない。
- スキーマ適用: Brain Pro は本番ビルド時 `prisma db push`（既存運用どおり）、ipro-bot は `npm run db:push`。
