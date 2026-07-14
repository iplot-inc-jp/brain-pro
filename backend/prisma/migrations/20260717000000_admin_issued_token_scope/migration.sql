-- 管理者によるメンバー用トークン発行（会社スコープ／Approach B）。
-- scope_org_id: 発行会社に限定するスコープ（null=自己発行の全社追従・従来どおり）。
-- issued_by_user_id: 監査用の発行者 userId（null=本人の自己発行）。
ALTER TABLE "user_api_tokens" ADD COLUMN "scope_org_id" TEXT;
ALTER TABLE "user_api_tokens" ADD COLUMN "issued_by_user_id" TEXT;

CREATE INDEX "user_api_tokens_scope_org_id_idx" ON "user_api_tokens"("scope_org_id");
