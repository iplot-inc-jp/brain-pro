# by-id 認可の会社スコープ ハードニング Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** brain-pro の全 by-id 認可を、スコープ非対応の `assertProjectAccess(projectId, userId)` から、スコープ対応の `assertPrincipalAccess(principal, projectId)` へ移行し、管理者発行トークン（会社スコープ）と サービスアカウント sk_ キー のスコープが**全データ経路で**効くようにする。

**Architecture:** `ProjectAccessService.resolveForPrincipal`（＝会社スコープ越境deny＋APIキースコープを判定する唯一の入口）を、by-id ルートのハンドラが確実に通るようにする。現状 `ProjectAccessGuard` は projectId を解決できない by-id ルートを素通りさせ、ハンドラが `assertProjectAccess(id, user.id)`（会員RBACのみ・scopeOrgId 無視）で認可していた。これを `assertPrincipalAccess(user, id)` に統一する。`meeting-occurrence.controller.ts` が既に正しい前例。

**Tech Stack:** NestJS + Prisma。テストは jest（backend colocated）。ブランチ `feat/admin-issued-member-token`（Tasks 1-7 の続き）。base = 46d419a。

## Global Constraints

- **正確な変換対象は `/Users/kazuyukijimbo/brain-pro/.superpowers/sdd/byid-scope-inventory.md` に全30サイト・行番号つきで列挙済み**。各タスクは自分の担当ファイルの節を読んで、そこに挙がったサイトだけを変換する（漏れ・過剰なし）。
- **変換ルール（全サイト共通・唯一）:**
  - **DIRECT サイト**（ハンドラが直接 `this.projectAccess.assertProjectAccess(X, user.id, R)` / `this.access.assertProjectAccess(X, user.id, R)` を呼ぶ）→ `this.projectAccess.assertPrincipalAccess(user, X, R)` に置換（`user.id` → `user`。`user` は既存の `@CurrentUser() user: CurrentUserPayload`）。メソッド名 `assertProjectAccess` → `assertPrincipalAccess`、引数順は `(principal, projectId, required)`。
  - **HELPER サイト**（private ヘルパが `userId: string` を受けて内部で `this.projectAccess.assertProjectAccess(X, userId, R)` を呼ぶ）→ (1) ヘルパの引数を `userId: string` → `principal: CurrentUserPayload` に変更（ネストした sub-helper も全て・変数名も principal に）、(2) 内部呼び出しを `this.projectAccess.assertPrincipalAccess(principal, X, R)` に、(3) そのヘルパの**全呼び出し元**を `user.id` → `user` に。
  - **entity-json のローカル `assertProjectAccess` ラッパ（自メソッド名衝突）**: ラッパ内の `orgRepo.isMember(project.organizationId, userId)` の追加チェックは**残す**（principal.id を使う）。その後段の `this.projectAccess.assertProjectAccess(projectId, userId, required)` を `assertPrincipalAccess(principal, projectId, required)` に。ラッパ自身の引数を `principal: CurrentUserPayload` に、10箇所の呼び出し元を `user` に。
  - `CurrentUserPayload` は既に各ファイルで import 済み（`@CurrentUser() user: CurrentUserPayload` を使っているため）。追加 import 不要な場合が多いが、ヘルパ型注釈で必要なら `import { CurrentUserPayload } from '../decorators/current-user.decorator'` を足す。
- **挙動非変更（回帰なし）の保証**: 通常ユーザー（scopeOrgId 無し・apiKeyRole 無し）では `assertPrincipalAccess(user, id, R)` は `resolveForPrincipal` 経由で `resolveProjectAccess(id, user.id)` に落ちる＝従来と同一。既存 244 テストは緑のまま。**新挙動は scoped トークン / sk_ キーのみ**（正しいスコープ enforcement）。
- **完全性ゲート（各タスク末尾で必須）**: 担当ファイルに対し `grep -nE "assertProjectAccess\((.*user\.id|.*\buserId\b)" <files>` が **0件**（＝スコープ非対応呼び出しが残っていない）。ただし `project-access.service.ts` 内の定義・`assertProjectAccess` メソッド自体の実装は対象外（サービス層の既存メソッドは残す）。
- backend jest: `cd /Users/kazuyukijimbo/brain-pro/backend && npx jest <path>`。tsc: `npx tsc --noEmit`。build: `npx nest build`。ローカルDB停止中＝テストは Prisma モック。
- 本番は `prisma db push`（schema 変更なしのタスク群なので DB 影響なし）。

---

### Task 8: business-flow.controller.ts（最大・ヘルパchain）

**Files:** Modify `backend/src/presentation/controllers/business-flow.controller.ts`
**Inventory:** 節2（サイト 3,4,5 = DIRECT / サイト6 = HELPER `assertFlowMembership` + sub-helper `assertNodeEditAccess`/`assertEdgeEditAccess`、計20ハンドラ呼び出し）

**Interfaces:**
- Consumes: `ProjectAccessService.assertPrincipalAccess(principal, projectId, required)`（既存）。
- Produces: このファイル内の全 by-id/create 認可が principal 経由。

- [ ] **Step 1: DIRECT 3サイトを変換**（1079, 1201, 2193）: `this.projectAccess.assertProjectAccess(X, user.id, R)` → `this.projectAccess.assertPrincipalAccess(user, X, R)`。

- [ ] **Step 2: ヘルパchainを変換**: `assertFlowMembership(flowId, userId, required)` → `assertFlowMembership(flowId, principal: CurrentUserPayload, required)`、内部 line 2337 を `assertPrincipalAccess(principal, flow.projectId, required)` に。sub-helper `assertNodeEditAccess(nodeId, userId)` / `assertEdgeEditAccess(edgeId, userId)` も `principal` 化し、内部の `assertFlowMembership(..., principal, ...)` へ。

- [ ] **Step 3: 20ハンドラ呼び出しを `user.id` → `user` に**（inventory 節2の行: 816,1118,1139,1153,1300,1359,1402,1519,1559,1689,1785,1816,1871,1889,1919,1960 と、node/edge 経由 1345,1651,1454,1504）。`CurrentUserPayload` 未 import なら追加。

- [ ] **Step 4: 完全性ゲート＋型チェック**
Run: `cd backend && grep -nE "assertProjectAccess\((.*user\.id|.*\buserId\b)" src/presentation/controllers/business-flow.controller.ts`
Expected: 0件。
Run: `cd backend && npx tsc --noEmit`
Expected: エラーなし。
Run: `cd backend && npx jest src/presentation/controllers/business-flow` （該当specがあれば）
Expected: 緑（無ければ tsc で可）。

- [ ] **Step 5: Commit**
```bash
git add backend/src/presentation/controllers/business-flow.controller.ts
git commit -m "fix(brainpro): business-flow の by-id 認可を assertPrincipalAccess へ（会社スコープ有効化）"
```

---

### Task 9: entity-json + table（ヘルパchain・ローカル名衝突）

**Files:** Modify `backend/src/presentation/controllers/entity-json.controller.ts`, `backend/src/presentation/controllers/table.controller.ts`
**Inventory:** 節6（entity-json ローカルラッパ + 10呼び出し）、節19（table `assertProjectEdit`+`assertTableEdit`+`assertColumnEdit`+`assertCrudMappingEdit` の4段chain + 8呼び出し）

**Interfaces:**
- Consumes: `assertPrincipalAccess`。Produces: 両ファイルの全認可が principal 経由。

- [ ] **Step 1: entity-json のローカルラッパを変換**: `private async assertProjectAccess(projectId, userId, required)` → `(projectId, principal: CurrentUserPayload, required)`。内部の `orgRepo.isMember(project.organizationId, userId)` は `orgRepo.isMember(project.organizationId, principal.id)` に（追加チェックは温存）、後段 line 262 を `this.projectAccess.assertPrincipalAccess(principal, projectId, required)` に。10呼び出し元（73,92,106,131,149,166,179,202,219,236）を `this.assertProjectAccess(X, user, R)` に（`user.id` → `user`）。

- [ ] **Step 2: table の4段chainを変換**: `assertProjectEdit(projectId, userId)` → `(projectId, principal)`、内部 line 199 を `assertPrincipalAccess(principal, projectId, 'edit')` に。`assertTableEdit`/`assertColumnEdit`/`assertCrudMappingEdit` を全て `principal: CurrentUserPayload` 化し、chain を principal で貫通。8ハンドラ呼び出し（259,284,306,327,354,384,417,430）を `user` に。

- [ ] **Step 3: 完全性ゲート＋型チェック**
Run: `cd backend && grep -nE "assertProjectAccess\((.*user\.id|.*\buserId\b)" src/presentation/controllers/entity-json.controller.ts src/presentation/controllers/table.controller.ts`
Expected: 0件（entity-json のローカルラッパ定義行 `private async assertProjectAccess(projectId: string, principal: ...)` は `userId` を含まないので 0 になる）。
Run: `cd backend && npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 4: Commit**
```bash
git add backend/src/presentation/controllers/entity-json.controller.ts backend/src/presentation/controllers/table.controller.ts
git commit -m "fix(brainpro): entity-json/table の by-id 認可を assertPrincipalAccess へ（会社スコープ有効化）"
```

---

### Task 10: requirement + role + dfd + stakeholder（flat・guard無効）

**Files:** Modify `requirement.controller.ts`, `role.controller.ts`, `dfd.controller.ts`, `stakeholder.controller.ts`
**Inventory:** 節16（requirement: DIRECT 244,342,391 + HELPER `assertRequirementAccess`/7呼び出し line144）、節18（role: DIRECT 89 + HELPER `assertRoleEditAccess`/3呼び出し line59）、節5（dfd: HELPER `assertDiagramMembership`/4呼び出し line420）、節17（stakeholder: DIRECT 420）

**Interfaces:** Consumes `assertPrincipalAccess`。Produces: 4ファイルの認可が principal 経由。

- [ ] **Step 1: requirement 変換**: DIRECT 244,342,391 を `assertPrincipalAccess(user, X, R)`。`assertRequirementAccess(id, userId, required)` → `(id, principal, required)`、内部 line144 を `assertPrincipalAccess`、7呼び出し（200,302,329,440,465,479,508）を `user` に。

- [ ] **Step 2: role 変換**: DIRECT 89 を principal。`assertRoleEditAccess(id, userId)` → `(id, principal)`、内部 line59 を `assertPrincipalAccess(principal, row.projectId, 'edit')`、3呼び出し（118,189,221）を `user` に。

- [ ] **Step 3: dfd 変換**: `assertDiagramMembership(diagramId, userId, required)` → `(diagramId, principal, required)`、内部 line420 を `assertPrincipalAccess`、4呼び出し（311,329,360,398）を `user` に。

- [ ] **Step 4: stakeholder 変換**: DIRECT 420 を `assertPrincipalAccess(user, stakeholder.projectId, 'edit')`。

- [ ] **Step 5: 完全性ゲート＋型チェック**
Run: `cd backend && grep -nE "assertProjectAccess\((.*user\.id|.*\buserId\b)" src/presentation/controllers/requirement.controller.ts src/presentation/controllers/role.controller.ts src/presentation/controllers/dfd.controller.ts src/presentation/controllers/stakeholder.controller.ts`
Expected: 0件。
Run: `cd backend && npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 6: Commit**
```bash
git add backend/src/presentation/controllers/requirement.controller.ts backend/src/presentation/controllers/role.controller.ts backend/src/presentation/controllers/dfd.controller.ts backend/src/presentation/controllers/stakeholder.controller.ts
git commit -m "fix(brainpro): requirement/role/dfd/stakeholder の by-id 認可を assertPrincipalAccess へ"
```

---

### Task 11: guard無し *ByIdController 群（最優先・唯一の防御線）

**Files:** Modify `diagram-element.controller.ts`, `image-board.controller.ts`, `node-attachment.controller.ts`, `page-screenshot.controller.ts`, `overview-matrix.controller.ts`, `meeting-document.controller.ts`, `job.controller.ts`, `sub-project.controller.ts`
**Inventory:** 節4,7,13,14,15,12,11,20（各 HELPER 1つ＋DIRECT job:289）

**Interfaces:** Consumes `assertPrincipalAccess`。Produces: guard バックストップ皆無だった by-id 群がスコープ対応に。

- [ ] **Step 1: 各ファイルの HELPER を principal 化**（inventory の該当節どおり）:
  - diagram-element `assert(id, userId, required)`（line303-309）→ principal、呼び出し317,329。
  - image-board `assertBoardAccess(boardId, userId, required)`（250-265）→ principal、呼び出し197,213,245。
  - node-attachment `assert(id, userId, required)`（151-155）→ principal、呼び出し159,172。
  - page-screenshot `assertAccess(id, userId, required)`（258-265）→ principal、呼び出し235,254。
  - overview-matrix `assertAccess(matrixId, userId, required)`（413-429）→ principal、呼び出し284,298,382,410。
  - meeting-document `assertDocAccess(id, userId, required)`（397-408, `{projectId}` を返す）→ principal、呼び出し232,247,309,358,392。
  - sub-project `assertSubProjectEditAccess(id, userId)`（71-81）→ principal、呼び出し124,151。
- [ ] **Step 2: job.controller の DIRECT を変換**（line289）: `this.projectAccess.assertProjectAccess(job.projectId, user.id, 'view')` → `assertPrincipalAccess(user, job.projectId, 'view')`（`job.projectId` が非nullの分岐のみ・null分岐の creator/super-admin フォールバックは不変）。

- [ ] **Step 3: 完全性ゲート＋型チェック**
Run: `cd backend && grep -nE "assertProjectAccess\((.*user\.id|.*\buserId\b)" src/presentation/controllers/diagram-element.controller.ts src/presentation/controllers/image-board.controller.ts src/presentation/controllers/node-attachment.controller.ts src/presentation/controllers/page-screenshot.controller.ts src/presentation/controllers/overview-matrix.controller.ts src/presentation/controllers/meeting-document.controller.ts src/presentation/controllers/job.controller.ts src/presentation/controllers/sub-project.controller.ts`
Expected: 0件。
Run: `cd backend && npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 4: Commit**
```bash
git add backend/src/presentation/controllers/diagram-element.controller.ts backend/src/presentation/controllers/image-board.controller.ts backend/src/presentation/controllers/node-attachment.controller.ts backend/src/presentation/controllers/page-screenshot.controller.ts backend/src/presentation/controllers/overview-matrix.controller.ts backend/src/presentation/controllers/meeting-document.controller.ts backend/src/presentation/controllers/job.controller.ts backend/src/presentation/controllers/sub-project.controller.ts
git commit -m "fix(brainpro): guard無し by-id コントローラ群の認可を assertPrincipalAccess へ（スコープ唯一の防御線）"
```

---

### Task 12: guard-covered DIRECT 群（一貫化・defense-in-depth）

**Files:** Modify `blob-upload.controller.ts`, `drive.controller.ts`, `ingestion-source.controller.ts`, `ingestion-upload.controller.ts`, `knowledge.controller.ts`
**Inventory:** 節1,3,8,9,10（全 DIRECT。これらは guard が projectId を解決できるので既にスコープ済みだが、一貫性のため統一）

**Interfaces:** Consumes `assertPrincipalAccess`。

- [ ] **Step 1: DIRECT 8サイトを変換**:
  - blob-upload: 49, 72（`this.access.assertProjectAccess(projectId, user.id, 'edit')` → `this.access.assertPrincipalAccess(user, projectId, 'edit')`。注: このファイルは `this.access`）。
  - drive: 64, 147, 182。
  - ingestion-source: 62。ingestion-upload: 77。knowledge: 334。
  すべて `this.projectAccess.assertProjectAccess(X, user.id, R)` → `assertPrincipalAccess(user, X, R)`。

- [ ] **Step 2: 完全性ゲート＋型チェック**
Run: `cd backend && grep -nE "assert(Project)?Access\((.*user\.id|.*\buserId\b)" src/presentation/controllers/blob-upload.controller.ts src/presentation/controllers/drive.controller.ts src/presentation/controllers/ingestion-source.controller.ts src/presentation/controllers/ingestion-upload.controller.ts src/presentation/controllers/knowledge.controller.ts`
Expected: 0件。
Run: `cd backend && npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 3: Commit**
```bash
git add backend/src/presentation/controllers/blob-upload.controller.ts backend/src/presentation/controllers/drive.controller.ts backend/src/presentation/controllers/ingestion-source.controller.ts backend/src/presentation/controllers/ingestion-upload.controller.ts backend/src/presentation/controllers/knowledge.controller.ts
git commit -m "fix(brainpro): guard-covered な DIRECT 認可も assertPrincipalAccess へ統一"
```

---

### Task 13: 管理面ガード（api-key / ipro-bot-connection）＋DTO上限

**Files:** Modify `api-key.controller.ts`, `ipro-bot-connection.controller.ts`, `organization.controller.ts`
**Inventory:** 「Other confirmed sites」節（api-key:61,84 / ipro-bot-connection:34,70,82,119 / organization IssueMemberApiTokenDto:76-79）

**Interfaces:**
- Consumes: `CurrentUserPayload.scopeOrgId`（Task 3 で追加済）、`ForbiddenError`/`ForbiddenException`（各ファイルの既存 import に合わせる）。
- Produces: 管理者発行スコープトークンが、他社の sk_ キー発行・ipro-bot 接続管理をできない。

- [ ] **Step 1: api-key の `assertOrgAdmin` にスコープ検査**: `assertOrgAdmin(userId: string, organizationId: string)` を `assertOrgAdmin(user: CurrentUserPayload, organizationId: string)` に変更し、先頭に `if (user.scopeOrgId && user.scopeOrgId !== organizationId) throw new ForbiddenException('この会社を操作する権限がありません');`（このファイルが使う例外型に合わせる。`ForbiddenException` が未 import なら `@nestjs/common` から追加）。内部の `userId` 参照を `user.id` に。呼び出し line84 を `this.assertOrgAdmin(user, dto.organizationId)` に。

- [ ] **Step 2: ipro-bot-connection の `assertCompanyAdmin` にスコープ検査**: `assertCompanyAdmin(organizationId: string, userId: string)` を `assertCompanyAdmin(organizationId: string, user: CurrentUserPayload)` に変更し、先頭に同様の scope guard。内部 `userId` → `user.id`。呼び出し70,82,119 を `assertCompanyAdmin(orgId, user)` に（各ハンドラの `@CurrentUser() user` を渡す）。

- [ ] **Step 3: DTO 上限**: `organization.controller.ts` の `IssueMemberApiTokenDto.name` に `@MaxLength(100)` を追加（`import` に `MaxLength` が無ければ `class-validator` から追加。既に `IsString` を import 済み）。

- [ ] **Step 4: 完全性＋型チェック**
Run: `cd backend && grep -n "scopeOrgId" src/presentation/controllers/api-key.controller.ts src/presentation/controllers/ipro-bot-connection.controller.ts`
Expected: 各ファイルに scope guard 行が出る。
Run: `cd backend && npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 5: Commit**
```bash
git add backend/src/presentation/controllers/api-key.controller.ts backend/src/presentation/controllers/ipro-bot-connection.controller.ts backend/src/presentation/controllers/organization.controller.ts
git commit -m "fix(brainpro): api-key/ipro-bot-connection の会社管理ガードを scope 対応＋発行DTOに上限"
```

---

### Task 14: 回帰テスト＋全体グリーン確認

**Files:** Create `backend/src/presentation/controllers/entity-json.controller.scope.spec.ts`（代表1本）

**Interfaces:** Consumes `EntityJsonController`（Task 9 変換後）、`ProjectAccessService` をモック。

- [ ] **Step 1: 代表 by-id ルートが principal 経由になったことを検証するテスト**

```typescript
import { EntityJsonController } from './entity-json.controller';

// by-id ルート(getFlowJson)がスコープ非対応の assertProjectAccess ではなく
// スコープ対応の assertPrincipalAccess を、フルの user(principal) で呼ぶことを検証。
describe('EntityJsonController by-id scope wiring', () => {
  it('getFlowJson は assertPrincipalAccess を user(principal) で呼ぶ（scope 対応経路）', async () => {
    const projectAccess = {
      assertPrincipalAccess: jest.fn().mockResolvedValue(undefined),
      assertProjectAccess: jest.fn(), // 呼ばれてはいけない
    } as any;
    const orgRepo = { isMember: jest.fn().mockResolvedValue(true) } as any;
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-9' }) },
    } as any;
    // getFlowJson が読むエンティティ（business flow）→ projectId を返す use-case/repo をモック。
    // ※実際のコンストラクタ依存は entity-json.controller.ts の constructor に合わせて最小 stub を渡す。
    const deps = makeEntityJsonDeps({ projectAccess, orgRepo, prisma }); // 下の helper
    const ctrl = deps.controller;
    const user = { id: 'member-1', email: '', scopeOrgId: 'org-9' } as any;

    await ctrl.getFlowJson(user, deps.flowId).catch(() => undefined);

    expect(projectAccess.assertPrincipalAccess).toHaveBeenCalled();
    const [principalArg] = projectAccess.assertPrincipalAccess.mock.calls[0];
    expect(principalArg).toBe(user); // user.id ではなく user(principal) 全体
    expect(projectAccess.assertProjectAccess).not.toHaveBeenCalled();
  });
});
```

実装者へ: `makeEntityJsonDeps` は entity-json.controller.ts の実 constructor 引数に合わせて最小 stub を組む（getFlowJson がラッパ `assertProjectAccess` を通り、その中で `orgRepo.isMember`（true）→ `projectAccess.assertPrincipalAccess` を呼ぶ所まで到達すれば良い。flow ロードは projectId を返す stub で可）。constructor が重い場合は、テストを「ラッパ経由で assertPrincipalAccess が principal 全体で呼ばれる」ことに絞ってよい（過剰な stub を避ける）。もし constructor 依存が過大で健全なテストが組めないと判断したら、代替として `business-flow.controller.ts` の DIRECT ハンドラ（例 updateNodePositions）で同等の検証に切り替えてよい（どちらか1本で可）。

- [ ] **Step 2: テスト実行**
Run: `cd backend && npx jest src/presentation/controllers/entity-json.controller.scope.spec.ts`
Expected: PASS。

- [ ] **Step 3: 全体グリーン確認（回帰なし）**
Run: `cd backend && npx jest`
Expected: 全スイート緑（Tasks 1-13 の変換後も既存が緑。通常ユーザーで挙動不変のため）。数値を報告に記載。
Run: `cd backend && npx tsc --noEmit && npx nest build`
Expected: 両方成功。

- [ ] **Step 4: 全コントローラの完全性ゲート（最終）**
Run: `cd backend && grep -rnE "assert(Project)?Access\((.*user\.id|.*\buserId\b)" src/presentation/controllers | grep -v ".spec.ts"`
Expected: **0件**（サービス層 `project-access.service.ts` は controllers 配下でないので対象外。もし1件でも残れば変換漏れ＝要修正）。

- [ ] **Step 5: Commit**
```bash
git add backend/src/presentation/controllers/entity-json.controller.scope.spec.ts
git commit -m "test(brainpro): by-id 認可が scope 対応 assertPrincipalAccess を通ることの回帰テスト"
```

---

## Self-Review

**Spec coverage:** 30サイト全て（DIRECT17/HELPER13）を Tasks 8-12 に配分（business-flow / entity-json+table / requirement+role+dfd+stakeholder / guard無しById群8ファイル / guard-covered5ファイル）。管理面2＋DTO = Task 13。回帰＋完全性 = Task 14。inventory md が唯一の真実で、各タスクが自ファイルの節を参照。

**非回帰の根拠:** 通常ユーザーで `assertPrincipalAccess`≡`assertProjectAccess`（resolveForPrincipal が scopeOrgId/apiKeyRole 無しで resolveProjectAccess に落ちる）。sk_ キー / scoped トークンのみ挙動が「正しく」変わる（＝意図した hardening）。既存 sk_ 統合が by-id で広くアクセスしていた場合は今後スコープに絞られる点は仕様変更（デプロイ後に周知）。

**Type consistency:** 全ヘルパの `userId: string` → `principal: CurrentUserPayload`、`assertPrincipalAccess(principal, projectId, required)` の引数順で統一。entity-json のローカル名衝突ラッパは principal 化しつつ isMember 追加チェックを温存。
