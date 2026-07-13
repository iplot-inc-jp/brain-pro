-- APIキーをサービスアカウント化する: ロール（企業管理者/一般ユーザー）＋会社の紐付けを持たせる。
-- role=COMPANY_ADMIN … organization_id の会社の全プロジェクトにフルアクセス
-- role=GENERAL_USER  … organization_id の会社のうち project_id に紐付いたプロジェクトのみ
-- 認可は ProjectAccessGuard がこのスコープで判定する。

-- ロール enum
CREATE TYPE "ApiKeyRole" AS ENUM ('COMPANY_ADMIN', 'GENERAL_USER');

-- 会社の紐付け（サービスアカウントが属する会社）
ALTER TABLE "api_keys" ADD COLUMN "organization_id" TEXT;

-- ロール（既定は最小権限の一般ユーザー。既存行はこの既定になる）
ALTER TABLE "api_keys" ADD COLUMN "role" "ApiKeyRole" NOT NULL DEFAULT 'GENERAL_USER';

-- 会社への外部キー（会社削除でキーも消える）
ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
