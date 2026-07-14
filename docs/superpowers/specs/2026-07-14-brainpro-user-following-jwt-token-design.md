# brain-pro ユーザー追従APIトークン（JWT）設計

**Goal:** brain-pro の外部APIキーを、ipro-kun のサービスアカウントJWTと同じ HS256 JWT 形式にし、トークンに埋めたユーザーの**現在の権限に追従**して認可する（＝発行ユーザーが見えるプロジェクトしか触れない）。

**動機:** ipro 側と鍵の形式・思想を揃える（一貫性）。既存 sk_ キーの独立スコープ方式をやめ、「トークンは本人性＋世代を証明、権限はDBの現在値で毎回解決」という ipro の権限追従モデルに合わせる。

**対象リポジトリ:** brain-pro（主作業：発行・検証・失効）／ ipro-kun（小改修：`x-api-key`→`Authorization: Bearer <jwt>`）。

---

## 1. 背景（現状）

### brain-pro
- 外部API/MCP 認証は `ApiKeyService`（`backend/src/infrastructure/services/api-key.service.ts`）が発行する **不透明キー `sk_<base64url>`**。DBには sha256 ハッシュのみ保存（`api_keys.key_hash @unique`）。
- `JwtAuthGuard`（`backend/src/presentation/guards/jwt-auth.guard.ts`）は Bearer を2方式受ける:
  1. **APIキー**: `x-api-key` か `Authorization: Bearer sk_…` → `apiKey.findUnique({keyHash})` → `request.user = { id, apiKeyId, apiKeyRole, organizationId, projectId, projectIds }`（**キー自身のスコープ**）。
  2. **ユーザーJWT**（ログイン用）: `Authorization: Bearer <jwt>` → `TokenService.verifyToken` → `request.user = { id, email }`（apiKeyRole 無し）。
- 認可は `ProjectAccessGuard` → `ProjectAccessService.resolveForPrincipal(principal, projectId)`（`backend/src/infrastructure/services/project-access.service.ts`）:
  - `principal.apiKeyRole && principal.organizationId` があれば **キーのスコープ**で判定（`resolveApiKeyProjectAccess`）。
  - **無ければユーザーの会員RBAC**で判定（`resolveProjectAccess(projectId, userId)`：super-admin / org OWNER・ADMIN → EDIT ／ ProjectMember.accessLevel ／ 非会員 → null）。
- **重要な既存事実:** `request.user` に `apiKeyRole` を付けずに userId だけ載せれば、既存コードがそのまま**ユーザーの現在の会員RBAC**で毎回プロジェクトを絞る。＝「権限追従」に必要な認可ロジックは既に存在する。

### ipro-kun（揃える対象＝参照実装）
- `src/shared/lib/service-account-auth.ts`：HS256 JWT を node crypto のみで自前実装。
  - claims: `sub`（アカウントid）/ `cid` / `role` / `pids` / `w` / `tv`（token_version）/ `iat` / `exp`。
  - **DBが正**：検証時に `findActiveServiceAccount(sub)` を引き、`tokenVersion` 不一致・失効は拒否。
  - **権限追従モード**（`userId` 紐付きアカウント）：`resolveFollowScope(userId, companyId)` でログインの**現在の会社ロール／プロジェクト**に毎回上書き。非会員・降格なら null（fail-closed）。
- ipro-kun→brain-pro の送信は `ipro-agent/core/brainpro.ts` の5か所すべて `headers: { "x-api-key": link.apiKey }`。

---

## 2. 設計概要

brain-pro に **「ユーザー追従APIトークン」= 署名済み JWT** を新設する。トークンは**本人（userId）＋失効用の識別子（jti）**だけを主張し、org/プロジェクトの権限は **claim に焼き込まない**。毎リクエスト、brain-pro が userId の**現在の会員RBAC**で認可する。

- 発行ユーザーが降格・除名されれば、トークンは即時に権限を失う（fail-closed）。
- トークン単位で失効できる（1本だけ切っても他の連携は生存）。
- 既存 sk_ キーはそのまま併存（後方互換）。

---

## 3. トークン形式（ipro と同じ HS256・自前 crypto）

```
base64url(header).base64url(payload).base64url(HMAC-SHA256)
header  = { "alg": "HS256", "typ": "JWT" }
payload = { "sub": "<brain-pro userId>", "jti": "<user_api_tokens.id>", "kind": "user-api", "iat": <sec>, "exp": <sec> }
```

- **署名鍵:** 新規 env `BRAINPRO_API_JWT_SECRET`（ログイン用 JWT 鍵とは独立。独立ローテ可・区別が明快）。
- **有効期限:** 機械間・長寿命（既定 365 日）。失効はDB（`revokedAt`）で即時に効かせる。
- **`kind: "user-api"`:** ガードが「これは API トークン」と判別するためのマーカー（ログイン JWT と混ざらない）。
- **署名検証は timing-safe**（`crypto.timingSafeEqual`。ipro と同じ）。

> 注: `kind` は payload のカスタムクレーム。header の `typ:"JWT"` とは別物（ガードは payload の `kind` を見る）。

---

## 4. brain-pro コンポーネント

### 4.1 データモデル（新テーブル `UserApiToken`）

sk_ 用 `api_keys` は `key_hash @unique NOT NULL` と org/role/projects スコープ列を持ち、ユーザー追従トークンには合わない。用途特化の最小テーブルを新設する（`prisma/schema.prisma`）:

```prisma
model UserApiToken {
  id         String    @id @default(uuid())   // = JWT の jti
  userId     String    @map("user_id")
  name       String                           // 発行時のラベル（例: "ipro-kun 連携"）
  lastUsedAt DateTime? @map("last_used_at")
  revokedAt  DateTime? @map("revoked_at")
  createdAt  DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("user_api_tokens")
}
```

`User` モデルに `userApiTokens UserApiToken[]` の逆リレーションを追加。migration は Prisma（`prisma/migrations`。デプロイ時に適用）。

### 4.2 発行（Issuer）

- **サービス** `UserApiTokenService`（`backend/src/infrastructure/services/`）:
  - `mint(userId, name): { token: string; record: UserApiToken }` — 先に `user_api_tokens` 行を作成（id=jti）→ その id を jti に埋めて HS256 署名 → 平文JWTは**返り値のみ**（DBには署名も平文も保存しない。sk_ と同じ「一度だけ表示」）。
  - `revoke(userId, tokenId)` — 自分のトークンだけ `revokedAt` を立てる。
  - `list(userId)` — 自分の発行済みトークン（id・name・createdAt・lastUsedAt・revokedAt。平文は出さない）。
- **エンドポイント**：`dashboard/settings` から叩ける自己管理API（ログインJWTで認証、対象は常に「自分」）。
  - `POST /api/user/api-tokens`（body: `{ name }`）→ 201 `{ id, name, token, createdAt }`（token は1回だけ）。
  - `GET /api/user/api-tokens` → 一覧（token 無し）。
  - `DELETE /api/user/api-tokens/:id` → 失効。
- **フロントエンド**（`frontend`）：`dashboard/settings` に「APIトークン」セクション（発行→平文を1回表示してコピー、一覧、失効）。**sk_ 発行UIは残す**（後方互換）。

### 4.3 検証（Guard 拡張）

`JwtAuthGuard.canActivate` の Bearer 経路を拡張する。sk_ チェック（現状のまま先頭）→ 次に Bearer JWT を以下で分岐:

1. payload を**署名前にデコード**（base64url）して `kind` を見る。
2. `kind === "user-api"` の場合:
   - `BRAINPRO_API_JWT_SECRET` で HS256 を timing-safe 検証。不一致→401。
   - `exp` 切れ→401。
   - `prisma.userApiToken.findUnique({ where: { id: jti } })` を引き、無い/`revokedAt` あり→401。
   - `sub`（userId）と行の `userId` 一致を確認（不一致→401）。
   - `request.user = { id: sub }`（**apiKeyRole を付けない**＝ユーザーRBAC経路へ）。
   - `lastUsedAt` を fire-and-forget 更新（失敗しても認証継続）。
3. それ以外 → 既存の `TokenService.verifyToken`（ログインJWT）経路。

> 実装メモ: 分岐は「payload に `kind:"user-api"` があるか」で決める。ログインJWTには `kind` が無いので衝突しない。`ApiKeyService.extract` は `sk_` 前提なので JWT は必ず Bearer 経路を通る（現状のまま）。

### 4.4 認可セマンティクス（＝既存を再利用）

- `request.user.id`（apiKeyRole 無し）→ `ProjectAccessGuard` → `resolveForPrincipal` が**ユーザーの会員RBAC**で判定。追加ロジック不要。
- **読み書き可**（ipro の権限追従トークンは read-only だが、ここは意図的に read-write）。ipro-kun は brain-pro に書き込む（案件作成・業務フロー/課題ツリー保存）ため。書込可否はユーザーの EDIT 権限（`resolveProjectAccess` が EDIT を返すか）に従う。
- **org 直下の作成**（`POST /api/organizations/:organizationId/projects` 等、projectId が無いルート）は `ProjectAccessGuard` を素通りする（projectId 非依存）。
  - **実装計画で確認必須（本設計の唯一の認可リスク）:** これらの org ルートが `request.user.id` の**当該 org メンバーシップ**を検証しているか。現状は sk_ キーが `organizationId` スコープを持つ前提で通っていた可能性があり、ユーザー主体（apiKeyRole 無し）でも同じ確認が効くとは限らない。
  - 検証手順：`organization.controller.ts` / `project.controller.ts` の create 系ユースケースが `request.user.id` × `:organizationId` の `OrganizationMember` を確認しているか読む。**未検証なら本作業で追加する**（member でなければ 403）。これを怠ると user-api トークンで非会員が作成できる（fail-open）か、逆に会員でも一律 403 になる。
  - 本設計自体は認可の新規ロジックを持たず、`request.user.id` を正しく載せることに徹する。org メンバーシップ確認は既存 or 追記のコントローラ側チェックが担う。

---

## 5. ipro-kun コンポーネント（小改修）

- `ipro-agent/core/brainpro.ts` の送信ヘッダ5か所を `"x-api-key": apiKey` → `Authorization: \`Bearer ${apiKey}\`` に差し替え。
- 保存欄（`agent_brainpro_orgs.api_key` / `agent_brainpro_links.api_key` の文字列）は**スキーマ変更なし**。sk_ でも JWT でも「そのまま Bearer で送る」トークン文字列として扱う。
- UI 文言（`BrainproLinksView` / `BrainproOrgForm`）：「APIキー(sk_…)」を「APIキー / トークン」に緩め、発行先の案内に **JWT トークン発行**（brain-pro dashboard/settings の APIトークン）を追記。sk_ も引き続き有効と明記。
- 接続テスト（`/agent/links/fetch-projects` 等）も同じヘッダ差し替えで JWT を通す。

> ipro-kun 側は「トークン文字列を Bearer で送るだけ」に一般化するので、sk_／JWT の両対応が自然に成立する（brain-pro が両方受けるため）。

---

## 6. 後方互換と移行

- 既存 sk_ キーは `JwtAuthGuard` の sk_ 経路で**そのまま動作**（変更しない）。
- 新規連携は JWT トークン推奨。既存連携は任意のタイミングで再発行して差し替え（ipro-kun 側は文字列を貼り替えるだけ）。
- 一括移行やデータ変換は不要（両者は独立に共存）。

---

## 7. セキュリティ考慮

- **fail-closed**：署名不一致／期限切れ／行なし／`revokedAt`／`sub` 不一致 はすべて 401。
- **権限追従**：org/プロジェクト権限を claim に焼かない。降格・除名・ProjectMember 削除は次リクエストで即反映。
- **失効はトークン単位**：`revokedAt`。ユーザーの全トークン失効は将来的に「全 revoke」操作で対応可（本設計では単体失効のみ＝YAGNI）。
- **鍵分離**：`BRAINPRO_API_JWT_SECRET` はログイン JWT 鍵と別。片方のローテがもう片方に波及しない。
- **平文JWTは保存しない**：発行時の返り値のみ。DBは jti 行のメタデータだけ。
- **timing-safe 比較**でHMAC照合。
- **監査**：`lastUsedAt` を更新。

## 8. エラーハンドリング

- 発行API：署名鍵 env 未設定なら 500 相当のエラーメッセージ（「`BRAINPRO_API_JWT_SECRET` 未設定のため発行不可」）。ipro-kun 側の既存 `.catch` degrade はそのまま。
- 検証：上記 fail-closed。デコード失敗（不正 base64/JSON）も 401。
- ipro-kun：brain-pro が 401 を返したら既存のエラーメッセージ経路（`humanizeError` 等）で「トークンが無効/失効」を案内。

## 9. テスト

- **brain-pro（単体）**
  - `UserApiTokenService.mint`：jti が行id と一致・JWT が3分割・claims 正・`exp` 未来。
  - 検証：正常→`request.user={id}`／署名改竄→401／期限切れ→401／`revokedAt`→401／`sub`≠行userId→401／`kind` 無し→ログイン経路に落ちる。
  - `JwtAuthGuard`：`kind:"user-api"` JWT で apiKeyRole を**付けない**こと。sk_ と併存（sk_ は従来通り）。
  - `ProjectAccessGuard` 結合：ユーザーが org ADMIN → EDIT ／ ProjectMember VIEW → view のみ ／ 非会員 → 403（＝権限追従が効く）。
  - 失効API：他人のトークンを revoke できない（自分のみ）。
- **ipro-kun（単体）**
  - `brainpro.ts` が `Authorization: Bearer <token>` を送る（sk_ でも JWT でも）。回帰：既存の呼び出しがヘッダ差し替え後も通る。

## 10. スコープ外（YAGNI）

- ユーザーの全トークン一括失効（`tokenVersion` 方式）。単体失効で足りる。
- スコープ絞り込みクレーム（特定プロジェクトだけに限定するトークン）。「ユーザー権限に追従」が要件なので不要。
- sk_ キーの廃止・移行ツール。共存で足りる。
- ipro-kun 保存欄のスキーマ変更・トークン種別カラム。文字列 Bearer で一般化するため不要。
