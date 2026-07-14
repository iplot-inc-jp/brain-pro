# 管理者によるメンバー用トークン発行（会社スコープ／Approach B）Design

**日付:** 2026-07-15
**対象リポ:** brain-pro（backend ＋ frontend）。ipro 側は無変更。
**前提:** 既存の「ユーザー追従APIトークン(JWT)」機能（本番LIVE）の上に積む。self-service 発行はそのまま。

## Goal

brain-pro の**会社メンバー一覧で、会社管理者が各メンバー用のAPIトークン(JWT)を発行**できるようにする。
トークンは「そのメンバー本人の権限」で動くが、**発行した会社の中だけに効く（会社スコープ）**＝メンバーが他社に
所属していても、そのトークンで他社には届かない（Approach B）。

## 承認済み方針（前提）

- 発行できるのは**会社管理者（OWNER/ADMIN）または全体管理者**のみ。
- 対象は**その会社のメンバー**のみ。
- トークンは**対象メンバーの現在の権限に追従**（毎リクエスト live RBAC）。
- 発行・失効を**監査**（誰が発行したか＝issuedByUserId を記録・一覧表示）。
- **全体管理者(super-admin)を対象にした発行は禁止**（＝全社横断特権の漏れを塞ぐ・固定）。
- **会社スコープ(B)**: 管理者発行トークンは発行会社にだけ効く。

## アーキテクチャ（スコープの効かせ方）

スコープは**DBのトークン行(`user_api_tokens.scopeOrgId`)に持つ**（＝失効と同じく DB が真実・JWTには載せない）。
ガードは resolve 時に行から `scopeOrgId` を読み、`request.user` に載せる。以後2か所で効かせる:

1. **プロジェクト/知識データ（＝実データ全部）**: `ProjectAccessService.resolveForPrincipal` が唯一の入口
   （コメントに明記）。ここで「対象プロジェクトの会社 ≠ scopeOrgId なら null（越境deny）」を先に判定し、
   その後は従来どおり本人の live RBAC（`resolveProjectAccess`）。＝**業務フロー/タスク/イシュー/KPI/
   ステークホルダー/実会議 等すべてが発行会社に限定される**。
2. **会社管理系エンドポイント**: `OrganizationController.assertCompanyAdmin` に
   「`scopeOrgId` があり、要求 orgId と違えば Forbidden」を追加（メンバー/設定操作の越境も塞ぐ）。

### 残余（このフェーズの非対象・文書化）

`assertCompanyAdmin` を通さない**別コントローラ独自の会社管理チェック**があれば、そこは自動スコープされない
（トークンは本人として認証される）。ただしトークンの用途は自動化＝プロジェクト知識データ操作で、そこは(1)で
完全にスコープされる。会社管理系の主経路(2)も塞ぐため、実運用リスクは低い。全エンドポイント厳格スコープが要る
場合は後続で共通ガード化する。

## 変更点

### バックエンド（brain-pro）

1. **migration**: `user_api_tokens` に `scope_org_id TEXT NULL`、`issued_by_user_id TEXT NULL` を追加
   （既存 self-service 行は両方 NULL＝全社追従・従来どおり）。

2. **`UserApiTokenService`**:
   - `mint(userId, name, nowMs, opts?: { scopeOrgId?: string; issuedByUserId?: string })` … 行に保存。
   - `resolve(token, nowMs)` … 返り値を `{ userId, scopeOrgId }` に拡張（行から読む）。
   - `listForOrgMember(userId, orgId)` / `revokeForOrgMember(userId, orgId, tokenId)` … 会社管理者UI用
     （`scopeOrgId=orgId AND userId` に限定＝他会社・他人のトークンは見えない/消せない）。
   - 既存 `list(userId)`/`revoke(userId,id)`（self-service）は不変。

3. **`JwtAuthGuard`** user-api 分岐: `request.user = { id: resolved.userId, scopeOrgId: resolved.scopeOrgId ?? null }`。

4. **`AccessPrincipal` + `resolveForPrincipal`**: `scopeOrgId?: string | null` を追加。ユーザー経路の先頭で
   `scopeOrgId` があれば対象プロジェクトの `organizationId === scopeOrgId` を検証、違えば null。

5. **`assertCompanyAdmin(organizationId, user)`**（引数を id→user payload に）: 先頭で
   `if (user.scopeOrgId && user.scopeOrgId !== organizationId) throw ForbiddenError` を追加。呼び出し ~7 箇所を
   `assertCompanyAdmin(id, user)` に更新。

6. **`OrganizationController` 新エンドポイント**（すべて `assertCompanyAdmin` ＋ 対象メンバー確認 ＋ super-admin 禁止）:
   - `POST :id/members/:userId/api-tokens` … `mint(targetUserId, name, now, { scopeOrgId: id, issuedByUserId: user.id })`。平文JWTは1回だけ返す。
   - `GET :id/members/:userId/api-tokens` … `listForOrgMember(targetUserId, id)`。
   - `DELETE :id/members/:userId/api-tokens/:tokenId` … `revokeForOrgMember(targetUserId, id, tokenId)`。

### フロントエンド（brain-pro・`companies/[orgId]` メンバータブ）

- 各メンバー行に「APIトークン発行」→ 発行JWTを1回だけ表示（コピー）→ そのメンバーの（この会社スコープの）
  トークン一覧・失効。発行者(issuedBy)と発行日時を表示。

## セキュリティ

- **super-admin 対象は発行不可**（全社特権漏れ防止・固定）。
- **会社スコープ**: プロジェクトデータ(1)＋会社管理主経路(2)で越境を塞ぐ。
- fail-closed 継続（署名/期限/kind/jti行/revoked を既存どおり検証）。scopeOrgId は行＝失効即時反映。
- 平文JWTは発行時1回のみ。self-service 経路は完全に不変（回帰させない）。

## テスト方針（TDD）

- resolveForPrincipal: scopeOrgId 一致→本人RBAC / 不一致→null（越境deny） / scopeOrgId 無し→従来どおり。
- assertCompanyAdmin: scopeOrgId 不一致→Forbidden / 一致 or 無し→通す。
- 発行エンドポイント: 非管理者→403 / 非メンバー対象→403 / super-admin対象→403 / 正常→JWT1回＋行に scope/issuedBy。
- self-service（既存）回帰: scopeOrgId 無しで全社追従が不変。

## タスク分割（subagent-driven-development）

1. migration（scope_org_id / issued_by_user_id）
2. UserApiTokenService（mint opts / resolve 拡張 / listForOrgMember / revokeForOrgMember）
3. Guard（scopeOrgId を principal に）
4. resolveForPrincipal（越境deny）＋回帰テスト
5. assertCompanyAdmin（scope チェック＋呼び出し更新）
6. OrganizationController 発行/一覧/失効エンドポイント（admin＋member＋super-admin ガード）
7. frontend メンバータブ 発行/一覧/失効UI
