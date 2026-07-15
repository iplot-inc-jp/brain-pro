# use-case 層 認可の会社スコープ ハードニング Implementation Plan

> 続編。コントローラ層は `2026-07-15-brainpro-byid-scope-hardening.md`（Tasks 1-14, 完了）で対応済み。
> 本計画は最終レビューで判明した **use-case 層の scope 非対応認可 94 サイト**（内 `input.userId` 89 + `userId` ヘルパ 3 + 他 2）を閉じる。

**Goal:** brain-pro の use-case 層に残る `this.projectAccess.assertProjectAccess(projectId, input.userId, R)`（会員RBACのみ・scopeOrgId/apiKeyスコープ無視）を、スコープ対応の `assertPrincipalAccess(principal, projectId, R)` へ全面移行する。これにより管理者発行トークン（会社スコープ）と サービスアカウント sk_ キー のスコープが、コントローラを素通りして use-case 層で認可する **全 by-id 経路でも** 効く。

**なぜ必要（実害）:** `PUT /tasks/:id` は `@Controller('tasks')`（フラット）で `ProjectAccessGuard` が projectId を解決できず素通り→ `update-task.use-case.ts` が `input.userId` だけで認可→ **多社所属メンバーの会社スコープトークンが他社の task/stakeholder/comment 等を編集できる**。これは既存の穴（このブランチが作ったものではない）。本計画で「他社に届かない」保証を完成させる。

**Branch:** `feat/admin-issued-member-token`（コントローラ層修正の続き）。base = `cf8a3f8`。
**Repo/Test:** `cd /Users/kazuyukijimbo/brain-pro/backend`。tsc: `npx tsc --noEmit`。jest: `npx jest <path>`（ローカルDB停止中＝Prismaモック）。schema 変更なし＝本番 `prisma db push` 不要。

---

## 一様変換ルール（全サイト共通・唯一）

`AccessPrincipal` は `src/infrastructure/services/project-access.service.ts` からエクスポート済み（`{ id; apiKeyRole?; organizationId?; projectId?; projectIds?; scopeOrgId? }`）。`CurrentUserPayload`（controller の `@CurrentUser() user`）は構造的に `AccessPrincipal` へ代入可能。

### パターン A — DIRECT（use-case が直接 assertProjectAccess を呼ぶ）
1. 入力 interface に **`principal: AccessPrincipal;`（必須）** を追加（`userId: string` は温存＝webhook実行者・org判定など認可以外で使われるため）。`AccessPrincipal` を import。
2. `this.projectAccess.assertProjectAccess(<pid>, input.userId, <R>)` → `this.projectAccess.assertPrincipalAccess(input.principal, <pid>, <R>)`。第1引数が principal、順序は `(principal, projectId, required)`。
3. **全呼び出し元**に `principal:` を追加:
   - controller: `@CurrentUser() user: CurrentUserPayload` を持つ → `principal: user`。
   - `claude.service.ts` / `job.service.ts`（システム/バックグラウンド実行者・会社スコープ無し）→ `principal: { id: <既存userId> }`（scopeOrgId 無し＝従来どおり全社追従。挙動非変更）。
   - spec: `principal: { id: '<test-user-id>' }`（またはテストが使う user）。

### パターン B — HELPER（共有 `*-authz.ts` が `userId: string` を受ける）
対象: `dfd/dfd-authz.ts`(`authorizeDiagram`), `kpi/kpi-authz.ts`(`authorizeProject`), `data-object/data-object-authz.ts`(`authorizeProject`), その他 use-case 内 private ヘルパ。
1. ヘルパ引数 `userId: string` → `principal: AccessPrincipal`（変数名も principal）。
2. 内部 `orgRepo.isMember(project.organizationId, userId)` → `...principal.id`。
3. 内部 `projectAccess.assertProjectAccess(pid, userId, R)` → `projectAccess.assertPrincipalAccess(principal, pid, R)`。
4. **全呼び出し use-case** が `principal` を渡す（→ その use-case は パターンA の手順1で input に `principal` を持つ）。

---

## Global Constraints（各タスク末尾で必須ゲート）

- **挙動非変更（回帰なし）:** 通常ユーザー（scopeOrgId 無し・apiKeyRole 無し）では `assertPrincipalAccess` は `resolveForPrincipal`→`resolveProjectAccess(pid, principal.id)` に落ち従来と同一。新挙動は scoped トークン / sk_ キーのみ。
- **完全性ゲート①（担当ドメイン）:** `grep -rnE "assertProjectAccess\(" <担当domainのuse-caseファイル>` が **0件**（＝全て assertPrincipalAccess 化 or ヘルパ化済み）。
- **完全性ゲート②（tsc・最重要）:** `npx tsc --noEmit` が **0 エラー**。`principal` を必須にしたことで生じたエラーは、**発生箇所がどこであれ（controller / 他 use-case / claude.service / job.service / spec）全て**修正して緑にする。これがコンパイラによる完全性保証。
- **テストゲート:** 担当ドメインの jest spec が緑（`npx jest <domain path>`）。
- **Commit:** path-scoped `git add`（backend 配下のみ）。1ドメイン=1コミット。message 例: `fix(brainpro): <domain> の use-case 認可を assertPrincipalAccess へ（会社スコープ有効化）`。
- **禁止:** schema/prisma 変更、`assertProjectAccess` メソッド定義自体の削除（残す）、untracked ファイルの巻き込み、`.superpowers/` の add。

---

## Tasks（ドメイン単位・直列実行。各タスクは上記ルール＋ゲートを満たす）

- **T1** knowledge (12) + knowledge-settings (2)
- **T2** ingestion (8)
- **T3** task (8) + task-comment (3)
- **T4** issue-tree (6)
- **T5** gap-item (4) + meeting (4)
- **T6** dfd (3, incl `dfd-authz`) + data-object (1, `data-object-authz`) + kpi (1, `kpi-authz`) + flow-node (1)
- **T7** project-phase (3) + roadmap-phase (2) + report-calendar (2)
- **T8** flow-folder (3) + flow-definition (2) + flow-node-link (2)
- **T9** stakeholder (2) + interest-matrix-row (2) + information-type (2)
- **T10** asis-memo (2) + tobe-roadmap (2) + tobe-vision (2)
- **T11** product (2) + demand-data (2) + supplier (2)
- **T12** risk (2) + risk-category (2) + constraint (2) + system (2) + llm-usage (1)

## 最終検証（全タスク後）
- 全体 `npx tsc --noEmit` = 0、全体 `npx jest`（backend）= 従来 245+ 緑・回帰0。
- 全体完全性: `grep -rnE "assertProjectAccess\(" src/application/use-cases` = 0（定義は infrastructure に残る）。
- 敵対的レビュー: 会社スコープトークンで他社データに到達できる by-id 経路が残っていないか、独立検証者が反証を試みる。
