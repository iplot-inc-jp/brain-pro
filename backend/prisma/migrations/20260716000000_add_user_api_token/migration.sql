-- ユーザー追従APIトークン（JWT）の失効台帳。トークン自体は署名済みJWTで中身を持たず、
-- id（JWT の jti）で失効/最終使用のみをここに記録する。
CREATE TABLE "user_api_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_api_tokens_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_api_tokens_user_id_idx" ON "user_api_tokens"("user_id");

ALTER TABLE "user_api_tokens" ADD CONSTRAINT "user_api_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
