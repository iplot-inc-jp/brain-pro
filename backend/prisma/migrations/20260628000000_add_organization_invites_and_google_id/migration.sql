-- Add google_id to users (nullable, unique — for Google OAuth login)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "users_google_id_key" ON "users"("google_id");

-- Create organization_invites table
CREATE TABLE IF NOT EXISTS "organization_invites" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "created_by_user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "max_uses" INTEGER,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_invites_pkey" PRIMARY KEY ("id")
);

-- Unique index on token (invite link token must be globally unique)
CREATE UNIQUE INDEX IF NOT EXISTS "organization_invites_token_key" ON "organization_invites"("token");

-- Index for fast lookup by organization
CREATE INDEX IF NOT EXISTS "organization_invites_organization_id_idx" ON "organization_invites"("organization_id");

-- Foreign keys
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
