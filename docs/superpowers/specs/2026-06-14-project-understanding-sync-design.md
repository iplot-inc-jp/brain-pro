# プロジェクト理解の自動同期（ipro-bot → Brain Pro）設計

- 日付: 2026-06-14
- ステータス: 設計合意済み（実装はスケジューラ修正 #1/#2 に依存）
- 関連: `2026-06-11-iplot-integration-design.md`（Brain Pro 内部マスタ統合。本設計とは独立）

## 1. 背景・目的

ipro-bot は Slack / Microsoft Teams / Google Chat / Google Calendar / トラッカー（Linear/Backlog/Trello）から情報を取り込み、`documents`(RAG) に蓄積したうえで、プロジェクトごとの「理解」を2層で蒸留している:

- `project_memory` … 定期ジョブがチャンネル履歴を Claude で要約（decision / fact / open issue）
- `project_context` … 日次ジョブが memory+手動ピンを Claude(Haiku) で5〜8項目に要約し `source='auto'` 行を置換

つまり **「Slack 等の全情報からのプロジェクト理解」は ipro-bot 内に既に出来ている**。本設計のゴールは、その理解を **Brain Pro（brain-pro）に1プロジェクト=1枚のフリーテキスト「AI理解ノート」として定期自動で保存** し、Brain Pro 上で人間が確認・確定できるようにすることである。

現状、両システムを繋ぐ実装は存在しない（grep で参照ゼロ）。本設計はその橋渡しを新規に作る。

## 2. スコープ（MVP）

**IN**
- ipro-bot が既存 `project_memory` + `project_context(auto)` を素材に、Claude で整形した「理解ノート」を Brain Pro に upsert
- 定期自動同期（既存 durable job 基盤に乗せる）
- 対応する Brain Pro Project が無ければ自動作成してリンク

**OUT（将来フェーズ）**
- 構造化アーティファクト生成（BusinessFlow / IssueTree / GAP / KPI）
- 双方向同期、Brain Pro→ipro-bot
- 専用 UI（当面は既存のフリーテキスト表示で足りる）

## 3. アーキテクチャ

```
[ipro-bot] scheduled tick
   └─ enqueue dataflow_sync (per company, dedupKey)
        └─ job: listProjects(companyId)
             └─ 各 project:
                  ├─ recentProjectMemory + listProjectContext(auto+manual) を集約
                  ├─ link 解決（無ければ Brain Pro に project_create → links 保存）
                  ├─ Claude runStructured で「理解ノート」生成
                  └─ PUT /api/projects/:id/understanding (x-api-key) で upsert
[Brain Pro] ProjectUnderstanding を projectId+source で全置換 upsert → ChangeLog 記録
```

- **ipro-bot 側**: 新 durable job `dataflow_sync`。`src/jobs/pipelines/context-refresh.ts` を雛形にする（会社スコープ・listProjects ループ・runStructured・冪等）。
- **Brain Pro 側**: 新軽量モデル `ProjectUnderstanding`。NestJS で最小モジュール（`asis-memo` を雛形）＋ `x-api-key` 公開エンドポイント。MCP は `api_request` 脱出ハッチで叩けるが、curated tool `understanding_upsert` を1つ足すと使い勝手が良い。
- **マッピング**: ipro-bot 新テーブル `project_ai_data_flow_links`。

## 4. データモデル

### Brain Pro（Prisma, `backend/prisma/schema.prisma`）
```prisma
model ProjectUnderstanding {
  id         String   @id @default(cuid())
  projectId  String
  content    String   @db.Text          // Claude が生成した理解ノート（Markdown 可）
  confidence Confidence @default(HYPOTHESIS)
  source     String   @default("ipro-bot")
  sourceRef  String?                     // 由来（ipro projectId / job id 等、逆引き用）
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  project    Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@unique([projectId, source])          // upsert キー: 1プロジェクト1ノート/ソース
}
```
- `Confidence` enum は既存（HYPOTHESIS|CONFIRMED）を流用。
- マイグレーション: `npx prisma migrate dev`（本番は `prisma db push` が buildCommand に入っている）。

### ipro-bot（Drizzle, `src/db/schema.ts`）
```ts
export const projectAiDataFlowLinks = pgTable("project_ai_data_flow_links", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),       // ipro-bot projects.id
  companyId: text("company_id").notNull(),
  adfOrganizationId: text("adf_organization_id").notNull(),
  adfProjectId: text("adf_project_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({ ux: uniqueIndex("padfl_project_ux").on(t.projectId) }));
```

## 5. 取り込みフロー（end-to-end）

1. **スケジュール**: 既存の tick（#1/#2 修正後の QStash）から `dataflow_sync` を会社単位で enqueue。`dedupKey = dataflow_sync:{companyId}`。
2. **集約**: `listProjects(companyId)` → 各 project で `recentProjectMemory(id,15)` + `listProjectContext(id)` を取得し material を構築。空ならスキップ。
3. **リンク解決**: `project_ai_data_flow_links` を引く。無ければ Brain Pro で org を解決（MVP: 会社→既定 or 自動作成 org）し `project_create` → links に保存。
4. **整形**: `runStructured` で理解ノートを生成（節: 目的 / 現状 / 主要関係者 / 決定事項 / 未解決課題）。
5. **永続化**: `PUT /api/projects/:projectId/understanding` を `x-api-key` で呼び upsert（`source='ipro-bot'`, `sourceRef=ipro projectId`）。
6. **監査**: Brain Pro 側で ChangeLog を記録。

## 6. 冪等性・再実行

- ipro-bot job: `dedupKey` で in-flight 重複を抑止（既存 jobs 機構）。
- Brain Pro upsert: `@@unique([projectId, source])` で毎回**全置換**（追記しない＝重複しない）。
- 投入時は全件 `confidence=HYPOTHESIS`。**人間が Brain Pro UI で確認して CONFIRMED に昇格**（自動同期は HYPOTHESIS を上書きするが CONFIRMED は触らない、を将来オプションに）。

## 7. テナント境界・認証

- ipro company（=Slackテナント）↔ Brain Pro Organization の対応は `links` 経由。MVP は「1 company = 1 org」を既定とし、自動作成 or 既存 org 指定を初回設定で確定。
- 認証/設定は ipro-bot 既存の `companyIntegrations`（AES-256-GCM 暗号化）に `AIDATAFLOW_API_URL` + `AIDATAFLOW_API_KEY(sk_...)` を保存。HTTP クライアントは ipro-bot 側に新設（薄い fetch ラッパ）。
- Brain Pro の `x-api-key` は発行ユーザー権限で動作。書き込み専用に scope を絞る運用を推奨。

## 8. エラー処理

- API key 未設定/解決不可 → スキップ + warn（`context-refresh` と同様、ジョブは success 扱いで次へ）。
- Brain Pro 4xx/5xx → ジョブ retry（既存 lease/retry）。Brain Pro 側の恒久エラー（404 project 等）は fatal にして retry 浪費を防ぐ。

## 9. テスト

- **ipro-bot**: `dataflow_sync` 単体（material 集約 / 空スキップ / upsert ペイロード形）、リンク解決の get-or-create、API クライアントのエラー分岐。
- **Brain Pro**: `ProjectUnderstanding` CRUD、`x-api-key` ガード（未認証 401）、upsert 冪等（同 projectId+source は1行）。

## 10. フェーズ

- **P1（本設計の実装範囲）**: モデル+エンドポイント（Brain Pro）/ links+job+APIクライアント（ipro-bot）/ フリーテキスト理解ノートの定期 upsert / 自動 project 作成。
- **P2（将来）**: 構造化生成（ASIS フロー・課題木・GAP）、`sourceRef` からの Slack 逆引き、Brain Pro 上の理解ノート表示 UI、CONFIRMED 保護。

## 11. 依存・前提

- **稼働するスケジューラに依存**。本設計の自動同期は #1（Brain Pro スケジューラ QStash 化）/ #2（ipro-bot QStash 復旧）が前提。手動トリガ（@IPRO メンションやコマンド）でのオンデマンド実行を P1 に含めれば、スケジューラ修正前でも動作確認は可能。
