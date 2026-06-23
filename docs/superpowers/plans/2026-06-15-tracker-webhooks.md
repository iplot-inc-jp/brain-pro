# トラッカー Webhook 同期（インバウンド・ハイブリッド Jira+Backlog）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Goal:** Jira/Backlog の課題変更を webhook で即 ai-dataflow に反映する。接続(`IssueTrackerConnection`)ごとに発行する秘密トークン入り URL を Jira/Backlog 側へ手動登録 → イベント受信 → 当該1課題を fetch して `connection.projectId` へ upsert（sourceKey 冪等）。削除はクローズ扱い。既存ポーリングは webhook 有効接続では低頻度の取りこぼし補修として残す。

**Architecture:** NestJS クリーンアーキ。公開 `POST /api/trackers/webhook/:provider/:connectionId/:token`（`@Public()`）→ `ProcessTrackerWebhookUseCase`：token を timing-safe 検証 → イベント解釈（created/updated→単一課題 import / deleted→Task クローズ）。単一課題 import は既存 `TrackerImportService` の正規化+upsert 経路を1件で再利用（`jiraListIssues`/`backlogListIssues` を key フィルタで呼ぶ）。秘密は `CryptoService`(AES-256-GCM) で `IssueTrackerConnection.webhookSecretEnc` に保存し、管理画面で URL 表示。

**Tech Stack:** NestJS, Prisma, node:crypto(HMAC/timingSafeEqual), Next.js。テスト=jest。

**前提:** worktree `/Users/kazuyukijimbo/brain-pro-wt-webhooks`、ブランチ `feat/tracker-webhooks`（このブランチ/ディレクトリでのみ作業。main tree は別作業者が編集中）。各タスク後 `pnpm --filter @dataflow/backend build` と関連テストが緑。スキーマ変更後は `pnpm --filter @dataflow/backend exec prisma generate --schema=./prisma/schema.prisma`。

**重要・現行コード確認:** `tracker-import.service.ts` / `jira-api.ts` / `backlog-api.ts` / `task.entity.ts` は直近で大きく変更済み（アジャイル取込）。各タスクは**実ファイルを読んで現行シグネチャに合わせる**こと（本プランのコードは意図を示す骨子）。`jiraListIssues`/`backlogListIssues` の現行引数（options に JQL や projectKey, 単一key フィルタ可否）を確認し、無ければ「単一課題 fetch」関数を最小追加する。`@Public()` は cron.controller と同じ import 元から。`CryptoService` は `backend/src/infrastructure/services/crypto.service.ts`。

---

## File Structure
- Modify: `backend/prisma/schema.prisma`（`IssueTrackerConnection` に `webhookSecretEnc String? @map("webhook_secret_enc")`）
- Create: `backend/prisma/migrations/<timestamp>_tracker_webhook_secret/migration.sql`（prisma migrate dev が生成）
- Modify: `backend/src/infrastructure/services/trackers/tracker-import.service.ts`（単一課題 upsert メソッド抽出/追加）
- Modify: `backend/src/infrastructure/services/trackers/jira-api.ts` / `backlog-api.ts`（必要なら単一課題 fetch ヘルパ）
- Create: `backend/src/application/use-cases/tracker/process-tracker-webhook.use-case.ts` ＋ `.spec.ts`
- Create: `backend/src/application/use-cases/tracker/manage-tracker-webhook.use-case.ts`（秘密 生成/再生成 + URL 取得）＋ `.spec.ts`
- Create: `backend/src/presentation/controllers/tracker-webhook.controller.ts`（公開受信 ＋ 管理 endpoint）
- Modify: backend module（providers 登録）
- Modify: `backend/src/infrastructure/services/sync-scheduler.service.ts`（webhook 有効接続はポーリング間隔を実効的に延長）
- Modify: `frontend/src/components/tracker-connections-admin-panel.tsx` ＋ `frontend/src/lib/trackers.ts`（Webhook 節）

---

## Task 1: schema — webhookSecretEnc 追加

**Files:** `backend/prisma/schema.prisma`（+ migration 生成）

- [ ] **Step 1: `IssueTrackerConnection` モデルにフィールド追加**（`credentialEnc` の近くに）

```prisma
  // webhook 受信用の秘密トークン（AES-256-GCM 暗号化）。null=webhook 無効。URL に埋め込み timing-safe 照合。
  webhookSecretEnc String? @map("webhook_secret_enc")
```

- [ ] **Step 2: migration 生成＋client 再生成**

Run:
```
pnpm --filter @dataflow/backend exec prisma migrate dev --name tracker_webhook_secret --schema=./prisma/schema.prisma
pnpm --filter @dataflow/backend exec prisma generate --schema=./prisma/schema.prisma
```
Expected: migration ファイル生成、generate 成功。（DB 接続が無くて migrate dev が失敗する場合は `prisma migrate diff` で SQL を作るか、手書きで `ALTER TABLE issue_tracker_connections ADD COLUMN webhook_secret_enc text;` の migration.sql を作り、`prisma generate` だけ実行する。実環境のDB状態に合わせること。）

- [ ] **Step 3: build**

Run: `pnpm --filter @dataflow/backend build`
Expected: 成功（生成された Prisma 型に `webhookSecretEnc` が乗る）

- [ ] **Step 4: Commit**（明示 add のみ）

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(tracker-webhook): IssueTrackerConnection に webhookSecretEnc 追加（migration）"
```

---

## Task 2: 単一課題 import の再利用点を TrackerImportService に用意

**Files:** `tracker-import.service.ts`（必要なら `jira-api.ts`/`backlog-api.ts`）＋ テスト

> 目的: webhook 受信時に「変更された1課題だけ」を既存の正規化+upsert で取り込むメソッドを公開する。既存 `run()` の per-issue 処理（NormalizedIssue → Task upsert by sourceKey）を**抽出**して再利用する。新規ロジックは書かず既存を切り出すのが原則。

- [ ] **Step 1: 現行 `run()` を読み、per-issue upsert を切り出す**
- `run()` 内で「1件の NormalizedIssue を Task に upsert する」ブロックを `private upsertIssue(projectId, issue)` 等に抽出（挙動不変・既存テスト緑のまま）。
- 公開メソッド `async importSingleByKey(connectionId: string, externalKey: string): Promise<'upserted' | 'not_found'>` を追加:
  1. 接続を取得（provider/host/credential 復号/projectKey）。
  2. provider に応じ `jiraListIssues`/`backlogListIssues` を **その1 key に絞って**呼ぶ（現行 options に key/JQL 指定が無ければ、`jira-api`/`backlog-api` に単一 fetch ヘルパを最小追加：Jira `GET /rest/api/3/issue/{key}`、Backlog `GET /api/v2/issues/{idOrKey}` を NormalizedIssue に正規化。既存 normalize 関数を流用）。
  3. 得た NormalizedIssue を `upsertIssue(connection.projectId, issue)` で upsert。
  4. 親子/SP/sprint 等の既存処理は run() と同等に（単一なので親は既存 Task から sourceKey で引けたら張る／無ければ親なし）。

- [ ] **Step 2: テスト**（`tracker-import.service` の既存 spec があれば追記、無ければ新規 `tracker-import.single.spec.ts`。API クライアントと repo はモック）
- `importSingleByKey` が、fetch した1課題を sourceKey='PROVIDER:KEY' で upsert（既存あれば update、無ければ create）すること。
- 既存 `run()` 全体テスト（あれば）が緑のまま＝抽出のリグレッション無し。

- [ ] **Step 3: verify**

Run: `pnpm --filter @dataflow/backend test -- tracker-import && pnpm --filter @dataflow/backend build`
Expected: 緑・build 成功。

- [ ] **Step 4: Commit**

```bash
git add backend/src/infrastructure/services/trackers/
git commit -m "feat(tracker-webhook): TrackerImportService に単一課題 importSingleByKey を追加（既存upsert再利用）"
```

---

## Task 3: Webhook 秘密の管理（生成/再生成/URL）

**Files:** `manage-tracker-webhook.use-case.ts`(新規)＋spec、`tracker-webhook.controller.ts`(新規・管理側 endpoint 部分)、module 登録

- [ ] **Step 1: ManageTrackerWebhookUseCase（admin限定）**
- `enable(connectionId, userId)`: admin 検証（既存 tracker-connection.controller の assertAdmin 同等）→ ランダム秘密生成（`crypto.randomBytes(24).toString('base64url')`）→ `CryptoService.encrypt` して `webhookSecretEnc` 更新 → 平文は返さず、**URL を組んで返す**（`${PUBLIC_BASE_URL}/api/trackers/webhook/${provider}/${connectionId}/${secret}`）。webhook 有効化に伴い、ポーリング間隔を延長（Task5 と整合：例 `syncIntervalMinutes` を最低 1440 に引き上げ、または webhook フラグで scheduler 側が判断）。
- `regenerate(connectionId, userId)`: 新しい秘密に置換し新 URL を返す（旧 URL は無効化）。
- `disable(connectionId, userId)`: `webhookSecretEnc=null`（webhook 無効、ポーリング間隔は元に戻す/任意）。
- `getUrl(connectionId, userId)`: 現在の秘密を復号して URL を返す（管理画面の再表示用）。

- [ ] **Step 2: 管理 endpoint（tracker-webhook.controller.ts、認証あり=既存ガード）**
- `POST tracker-connections/:id/webhook/enable` → enable、`POST .../webhook/regenerate`、`POST .../webhook/disable`、`GET .../webhook/url`。レスポンスに URL（秘密入り）を含める（管理者のみ取得可）。

- [ ] **Step 3: テスト＋build**

Run: `pnpm --filter @dataflow/backend test -- tracker-webhook && pnpm --filter @dataflow/backend build`
Expected: 緑。enable が webhookSecretEnc をセットし URL を返す／非adminは弾く、を最低限テスト。

- [ ] **Step 4: Commit**

```bash
git add backend/src/application/use-cases/tracker/ backend/src/presentation/controllers/tracker-webhook.controller.ts backend/src/**/*.module.ts
git commit -m "feat(tracker-webhook): 秘密の生成/再生成/無効化＋URL取得（admin）"
```

---

## Task 4: インバウンド受信エンドポイント ＋ ProcessTrackerWebhookUseCase

**Files:** `process-tracker-webhook.use-case.ts`(新規)＋spec、`tracker-webhook.controller.ts`(受信endpoint 追記)

- [ ] **Step 1: 受信 endpoint（公開）**
```ts
@Public()
@Post('trackers/webhook/:provider/:connectionId/:token')
async receive(
  @Param('provider') provider: string,
  @Param('connectionId') connectionId: string,
  @Param('token') token: string,
  @Body() body: unknown,
): Promise<{ ok: true }> {
  await this.processTrackerWebhook.execute({ provider, connectionId, token, body });
  return { ok: true }; // 検証失敗でも 200/401 は use-case 側の例外で制御（下記）
}
```
> `@Public()` は cron.controller と同じ import 元。受信は常に素早く 2xx を返し、重い処理はインラインでも可（単一課題なので軽い）。検証失敗は 401 を投げる。

- [ ] **Step 2: ProcessTrackerWebhookUseCase**
1. connection を id で取得。無ければ 404。`webhookSecretEnc` 無ければ 401（webhook 無効）。
2. **token 検証**: `CryptoService.decrypt(webhookSecretEnc)` と `:token` を `crypto.timingSafeEqual`（長さ不一致は false）。不一致は 401。
3. **イベント解釈**（provider 別に body から「イベント種別」と「課題キー」を取り出す）:
   - Jira webhook: `body.webhookEvent`（`jira:issue_created|updated|deleted`）、`body.issue.key`。
   - Backlog webhook: `body.type`（1=課題追加,2=更新,...）等、`body.content.key_id`/プロジェクトキー＋`content.key_id` から `PROJ-<key_id>` を組む。**実際の payload 形は要確認**（Backlog は `project.projectKey` + `content.key_id`）。
4. created/updated → `trackerImport.importSingleByKey(connectionId, key)`。
5. deleted → Task を sourceKey='PROVIDER:KEY' で引き、`task.changeStatus('CLOSED')` して save（物理削除しない）。無ければ無視。
6. 例外時もログのみで握り（重複/未知イベントは無害化）。ただし token 不一致は 401 を投げる。

- [ ] **Step 3: テスト**（use-case 単体。trackerImport / connection repo / crypto をモック）
- 正しい token + Jira updated payload → `importSingleByKey(connectionId, 'PROJ-1')` が呼ばれる。
- deleted payload → 対応 Task が `changeStatus('CLOSED')`。
- 誤 token → 401（例外）。`webhookSecretEnc` null → 401。
- Backlog payload からの key 抽出。

- [ ] **Step 4: verify＋build**

Run: `pnpm --filter @dataflow/backend test -- process-tracker-webhook && pnpm --filter @dataflow/backend build`
Expected: 緑。

- [ ] **Step 5: Commit**

```bash
git add backend/src/application/use-cases/tracker/process-tracker-webhook.use-case.ts backend/src/application/use-cases/tracker/process-tracker-webhook.use-case.spec.ts backend/src/presentation/controllers/tracker-webhook.controller.ts
git commit -m "feat(tracker-webhook): インバウンド受信＋ProcessTrackerWebhookUseCase（token検証/単一import/削除はクローズ）"
```

---

## Task 5: ポーリング・バックストップ（webhook 有効接続は間隔延長）

**Files:** `sync-scheduler.service.ts`

- [ ] **Step 1: scheduler の対象選定を調整**
- 現行 `sync-scheduler.service.ts` の auto-sync 対象抽出を読み、`webhookSecretEnc != null`（webhook 有効）の接続は**実効ポーリング間隔を延長**（例: 最低 1440 分=日次に丸める）して取りこぼし補修のみにする。webhook 無効接続は従来どおり。
- 実装は「webhook 有効なら effectiveInterval = max(syncIntervalMinutes, 1440)」程度の最小変更。

- [ ] **Step 2: テスト**（scheduler の既存 spec があれば、webhook 有効接続が高頻度ポーリングされないケースを1つ追加。無ければ最小の単体）

- [ ] **Step 3: verify**

Run: `pnpm --filter @dataflow/backend test -- sync-scheduler && pnpm --filter @dataflow/backend build`
Expected: 緑（既存も不変）。

- [ ] **Step 4: Commit**

```bash
git add backend/src/infrastructure/services/sync-scheduler.service.ts
git commit -m "feat(tracker-webhook): webhook 有効接続はポーリングを日次バックストップに間引く"
```

---

## Task 6: フロント（管理画面 Webhook 節）

**Files:** `frontend/src/lib/trackers.ts`、`frontend/src/components/tracker-connections-admin-panel.tsx`

- [ ] **Step 1: lib/trackers.ts に API 関数**
- `enableWebhook(connectionId)→{url}`、`regenerateWebhook(connectionId)→{url}`、`disableWebhook(connectionId)`、`getWebhookUrl(connectionId)→{url|null}`。既存 trackers API の fetch ラッパに合わせる。

- [ ] **Step 2: admin パネルに「Webhook」節**
- 各接続の詳細に Webhook セクション: 状態（有効/無効）、`URL` のコピー欄（有効時のみ表示）、「Webhook を有効化」「URL 再生成」「無効化」ボタン。
- 文言: 「この URL を Jira/Backlog の Webhook 設定に貼り付けてください（課題の作成/更新/削除イベント）。URL には秘密が含まれます。」
- 既存 `tracker-connections-admin-panel.tsx` の体裁/状態管理に合わせる。

- [ ] **Step 3: frontend build**

Run: `pnpm --filter frontend build`
Expected: 成功。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/trackers.ts frontend/src/components/tracker-connections-admin-panel.tsx
git commit -m "feat(tracker-webhook): 管理画面に Webhook URL 表示/生成/無効化"
```

---

## Task 7: 最終検証
- [ ] **Step 1:** `pnpm --filter @dataflow/backend test && pnpm --filter @dataflow/backend build`（全 green / build 成功）
- [ ] **Step 2:** `pnpm --filter frontend build`（成功・/api・admin パネル含む）
- [ ] **Step 3: 受け入れ確認**
  1. `POST /api/trackers/webhook/:provider/:connectionId/:token` が公開で存在し、token 検証後にイベント処理。
  2. created/updated → `importSingleByKey` で当該1課題を `connection.projectId` に upsert（sourceKey 冪等）＝**Jira↔プロジェクト紐づけ維持**。
  3. deleted → 対応 Task が CLOSED（物理削除しない）。
  4. 誤/欠落 token → 401。
  5. 管理画面で Webhook URL を生成・再生成・無効化でき、URL に秘密入り。
  6. webhook 有効接続はポーリングが日次バックストップに間引かれる。
  7. backend test/build・frontend build 緑。

---

## 自己レビュー（writing-plans）
- **網羅:** schema=T1, 単一import再利用=T2, 秘密管理=T3, 受信=T4, ポーリング間引き=T5, UI=T6, 検証=T7。承認設計（手動URL登録/削除=クローズ/ポーリング自動延長/プロジェクト紐づけ保証）を全てカバー。
- **プレースホルダ:** 各タスクに具体手順。コードは骨子＋「現行シグネチャ確認」点（`tracker-import.run()` の per-issue 抽出・`jira/backlogListIssues` の単一fetch・Backlog payload 形）＝volatile な現行コードに合わせる実体確認で、推測穴ではない。
- **型整合:** `importSingleByKey(connectionId, key)`・`webhookSecretEnc`・URL 形 `/trackers/webhook/:provider/:connectionId/:token`・sourceKey='PROVIDER:KEY' を全タスクで一貫。秘密は CryptoService で暗号化、検証は timingSafeEqual。
