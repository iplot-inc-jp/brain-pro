# 会社招待リンク ＋ Google/メアド ログイン ＋ 複数会社切替 設計書

- 日付: 2026-06-28
- ブランチ: feat/methodology-pipeline
- 状態: 承認済み（実装計画フェーズへ）

## 1. 目的 / ゴール

1. **会社への招待リンク作成**: 会社管理者が招待リンクを発行し、共有できる。
2. **招待 → ログインへの動線**: リンクを開いた被招待者が、Google または メアドでサインインして、その会社に参加できる。
3. **複数会社への所属と切替**: 1 ユーザーが複数の会社に所属でき、UI で会社を切り替えられる。
4. **Google ログイン と メアド ログイン/新規登録 の両方**を用意する。

## 2. 現状（調査結果）

- **認証**: カスタム JWT。バックエンドは NestJS + Passport + `@nestjs/jwt` + bcrypt。フロントは `localStorage.accessToken` に保存し `Authorization: Bearer` で送信。
  - エンドポイント: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`。JWT payload は `{ sub: userId, email }`。
  - `next-auth@4.24.5` は依存に存在し `SessionProvider` がマウントされているが**実質未使用（デッドコード）**。`[...nextauth]` ルートは無い。
  - Google ログインは**未実装**（Google Drive 連携の OAuth は文書取り込み用で別物）。
  - `SUPER_ADMIN_EMAILS` env でスーパー管理者をブートストラップ。
- **データモデル（Prisma, `backend/prisma/schema.prisma`）**:
  - `User`（`password` は必須 String、`googleId` 無し）。
  - `Organization`（= 会社 / 組織）。`OrganizationMember`（join, role: OWNER/ADMIN/MEMBER/VIEWER）で **User ↔ Organization は既に多対多**。
  - `Project` は `organizationId` でスコープ。`ProjectMember`（VIEW/EDIT）。
  - 既存「招待」= 管理者が email でメンバー追加し、新規 email なら `password: ''` のユーザーを作る（招待状態フラグ `invited: !password`）。**招待リンクは無い。**
- **フロント**:
  - `(auth)/login`, `(auth)/register` ページ。`middleware.ts` 無し（クライアント側 localStorage 認証のみ）。
  - `lib/api.ts` が token を自動付与。UI は shadcn/Radix/Tailwind/Lucide。
  - `contexts/ProjectContext.tsx` が `selectedOrganization` を保持するが、**永続化なし・スイッチャー UI なし**。会社が 1 つの時だけ自動選択。`selectedProjectId` のみ localStorage 永続化。

## 3. 確定した設計判断（ユーザー承認済み）

- 招待リンクは **共有リンク方式**（会社 + ロール単位、URL を知る人は誰でも参加可、期限・無効化・最大利用回数あり）。
- Google 認証は **現状の JWT を維持し Google ボタンを追加**（フロントで ID トークン取得 → バックエンドで検証 → 既存と同じアプリ JWT を発行）。メアド/パスワードは両方式とも維持。
- Google OAuth クライアント ID は **未準備 → env-gate** で実装。`GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` 未設定の間はメアド認証のみ動作し、後から env を入れるだけで Google が有効化される。

## 4. 全体フロー

```
管理者が会社設定で「招待リンク」を発行
   → https://<app>/invite/<token> をコピーして共有
被招待者がリンクを開く（/invite/[token] 公開ページ）
   ├─ 未ログイン → Googleボタン or メアド(ログイン/新規登録) でサインイン
   │                 → 認証後そのトークンで会社に自動参加
   └─ ログイン済 → 「このアカウントで参加」ボタン（別アカウントにも切替可）
   → 参加完了 → /dashboard（その会社を選択済み状態で）
ヘッダーの会社スイッチャーでいつでも所属会社を切替
```

## 5. データモデル変更（要 `pnpm db:migrate`）

### 5.1 新規 `OrganizationInvite`

```prisma
model OrganizationInvite {
  id             String     @id @default(uuid())
  organizationId String     @map("organization_id")
  token          String     @unique
  role           MemberRole @default(MEMBER)
  createdByUserId String    @map("created_by_user_id")
  expiresAt      DateTime?  @map("expires_at")
  maxUses        Int?       @map("max_uses")
  useCount       Int        @default(0) @map("use_count")
  revokedAt      DateTime?  @map("revoked_at")
  createdAt      DateTime   @default(now()) @map("created_at")
  updatedAt      DateTime   @updatedAt @map("updated_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdBy    User         @relation("InviteCreatedBy", fields: [createdByUserId], references: [id])

  @@index([organizationId])
  @@map("organization_invites")
}
```

- `token` は `crypto.randomBytes(24).toString('base64url')` 相当の URL-safe ランダム文字列。
- 有効判定: `revokedAt == null` かつ（`expiresAt == null || expiresAt > now`）かつ（`maxUses == null || useCount < maxUses`）。
- `Organization` 側に `invites OrganizationInvite[]`、`User` 側に `createdInvites OrganizationInvite[] @relation("InviteCreatedBy")` を追加。

### 5.2 `User` 拡張

- `googleId String? @unique @map("google_id")` を追加（マイグレーションはこのカラム追加のみ）。
- `password` は **NOT NULL の String を維持**し、`''`（空文字）= 「パスワード未設定（Google のみ / 招待中）」とする。
  - 既存のメアドログイン use-case は既に `if (!user.password)` で空を弾く（**変更不要**）。Google ユーザーは `User.createWithGoogle(...)` で `password: ''` として作成。
  - 既存の「空文字パス＝招待中」運用と完全に整合し、既存 `password` カラムの nullable 移行（リスク）を回避する。

## 6. バックエンド設計（NestJS・既存クリーンアーキ準拠）

新規依存: `google-auth-library`。

### 6.1 Google 認証

- `POST /api/auth/google`（`@Public()`）
  - body: `{ idToken: string, inviteToken?: string }`
  - `GOOGLE_CLIENT_ID` 未設定なら `503`（機能無効）。
  - `OAuth2Client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })` で検証（aud / iss / exp）。`email_verified` 必須。
  - payload から `email, name, picture, sub(googleId)` を取得。
  - email でユーザー検索:
    - 既存 → `googleId` 未設定なら紐付け（アカウントリンク）、`avatarUrl`/`name` を補完。
    - 無し → 新規作成（`password: null`, `googleId`, `name`, `avatarUrl`）。
  - 既存 login/register と**同じアプリ JWT** を発行。
  - `inviteToken` があれば招待 accept を実行（6.2 と同ロジック、冪等）。
  - 返り値: `{ accessToken, user: { id, email, name, isSuperAdmin, avatarUrl } }`。

### 6.2 招待リンク

公開:
- `GET /api/invites/:token`（`@Public()`）— プレビュー。返却: `{ organizationName, role, valid: boolean, reason?: 'expired'|'revoked'|'maxed'|'notfound' }`。**機微情報は返さない**（メンバー一覧や API キー等は含めない）。

要認証:
- `POST /api/invites/:token/accept` — 現在のユーザーをその会社に参加させる。
  - 無効リンクは `400/410`。
  - `OrganizationMember` を upsert（既に所属なら何もしない＝**冪等**、`useCount` は増やさない）。新規参加時のみ `useCount++`。
  - role は招待の `role`（既存メンバーのロールは下げない）。
  - 返却: `{ organizationId }`（フロントはこれで会社を選択状態にする）。

招待管理（OWNER/ADMIN/superAdmin のみ。既存 `assertCompanyAdmin` 相当のガードを再利用）:
- `GET /api/organizations/:id/invites` — 一覧（token, role, expiresAt, maxUses, useCount, revokedAt, 有効判定, 完全な招待 URL）。
- `POST /api/organizations/:id/invites` — body: `{ role?: MemberRole=MEMBER, expiresInDays?: number, maxUses?: number }`。token 生成して作成 → 招待 URL を返す。
- `DELETE /api/organizations/:id/invites/:inviteId` — `revokedAt = now`（物理削除でなく無効化）。

### 6.3 既存エンドポイント

- メアド `login`/`register` は現状維持。
  - `login`: password が null/空のアカウントは「メアドログイン未設定」エラーで弾く（Google で作られたアカウント保護）。
  - 招待ページでのメアド登録/ログイン後の参加は、**フロントが続けて `POST /api/invites/:token/accept` を呼ぶ**（バックエンド改修を最小化）。
- `GET /api/organizations` が「ログインユーザーの所属会社のみ」を返すことを確認・必要なら調整（スイッチャーの母集合）。superAdmin は従来どおり全件でも可だが、スイッチャーは所属会社ベースで構成する。

## 7. フロントエンド設計（shadcn/Radix/Tailwind 準拠）

新規依存: `@react-oauth/google`（`GoogleOAuthProvider` + `GoogleLogin`）。

### 7.1 Google ボタン（env-gate）

- 共通コンポーネント `GoogleSignInButton`（仮）。`NEXT_PUBLIC_GOOGLE_CLIENT_ID` が無ければ `null` を返し非表示。
- `GoogleLogin` の `onSuccess` で `credential`（ID トークン）取得 → `POST /api/auth/google`（必要なら `inviteToken` 同梱）→ `accessToken` を localStorage 保存 → 遷移。
- `GoogleOAuthProvider` は client id がある時だけラップ（`providers.tsx` か各ページで条件付き）。

### 7.2 ページ

- **`/login`・`/register`**: 既存メアドフォームを温存しつつ Google ボタンを上部/下部に追加（gate 済み）。
- **新規 `/invite/[token]`（公開）**:
  - マウント時に `GET /api/invites/:token` でプレビュー取得。無効なら理由表示。
  - **ログイン済**（localStorage に token あり、`/auth/me` で確認）: 「<会社名> に <現アカウント> で参加」ボタン → `accept` → `/dashboard`。「別のアカウントでログイン」リンクで未ログイン UI に切替。
  - **未ログイン**: Google ボタン ＋ メアド（ログイン/新規登録 トグル）。いずれの認証後も `inviteToken` で `accept` → `/dashboard`。
  - 参加成功後は対象会社を選択状態にして `/dashboard` へ。

### 7.3 会社スイッチャー（複数会社切替）

- ダッシュボード上部（`(dashboard)/layout.tsx`）にドロップダウンを追加。所属会社一覧を表示し選択で切替。
- `ProjectContext` を拡張:
  - `selectedOrganizationId` を **localStorage 永続化**。初期化時に復元（無ければ先頭、所属が 1 つなら自動）。
  - 会社切替時に選択中プロジェクトをリセットし、その会社のプロジェクトを取得。
- 招待で会社が増えたら一覧に反映される（再フェッチ）。

### 7.4 会社設定ページに招待リンク UI

- `dashboard/companies/[orgId]` の「メンバー」タブ内に「招待リンク」セクションを追加（または近接タブ）。
  - 発行フォーム: ロール選択、期限（日数, 任意）、最大利用回数（任意）。
  - 一覧: URL（コピー ボタン）、ロール、期限、利用回数/上限、状態（有効/無効/期限切れ）、無効化ボタン。
- 権限は既存の OWNER/ADMIN/superAdmin チェックを流用。

## 8. テスト

- バックエンド ユニット（`.spec.ts`, 既存慣習）:
  - 招待 use-case: 発行 / プレビュー（有効・期限切れ・revoke・maxUses・notfound）/ accept 冪等 / useCount 増加条件 / 既存ロールを下げない。
  - Google 認証: verifier をモックし、新規作成・既存リンク・email_verified 必須・client id 未設定で 503・inviteToken 同時 accept。
  - login: password 未設定アカウントの拒否。
- 必要に応じてコントローラの軽い結線テスト。

## 9. 環境変数

- バックエンド: `GOOGLE_CLIENT_ID`（未設定なら Google エンドポイント無効）。`APP_BASE_URL`（招待 URL 組み立て用、未設定ならリクエスト Origin / フロント側で組み立て）。
- フロント: `NEXT_PUBLIC_GOOGLE_CLIENT_ID`（未設定なら Google ボタン非表示）。

## 10. スコープ外（今回やらない）

- NextAuth への移行（デッド `SessionProvider` は当面据え置き）。
- サーバーサイド route guard（`middleware.ts`）の全面導入。
- 招待メールの自動送信（リンクは手動共有）。
- 招待トークンのハッシュ保存（任意の追加ハードニングとして注記のみ。リンクは revoke/期限で失効可能）。
- 会社の新規作成 UI 拡張（現状の superAdmin 作成フローを踏襲。一般ユーザーは招待で参加）。

## 11. リスク / 留意点

- `password` は NOT NULL のまま `''`=未設定の規約で扱うため、`password` カラムのデータ移行は不要（追加カラムは `googleId` のみ）。既存の login use-case が空パスを弾く挙動を踏襲する。
- Google で作成したアカウントと同一メールの既存メアドアカウントは自動リンクする（同一メール = 同一人物前提）。
- 招待リンクは URL を知る全員が参加可能なため、期限・最大回数・revoke の運用を UI で明示する。
- スイッチャー追加に伴い `ProjectContext` の初期選択ロジックが変わる（リロード時の挙動を要確認）。
