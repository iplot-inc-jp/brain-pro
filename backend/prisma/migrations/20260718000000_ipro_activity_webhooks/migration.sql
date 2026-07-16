-- ipro-db から受信した活動イベントを、受信台帳・チャット原本・統合検索文書へ保存する。
-- URL token は SHA-256 hash、HMAC secret は CryptoService の暗号文だけを保持する。

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "ipro_webhook_sources" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "secret_enc" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_received_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ipro_webhook_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ipro_webhook_receipts" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "error" TEXT,
    "metadata" JSONB,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    CONSTRAINT "ipro_webhook_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ipro_activity_rooms" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "external_room_id" TEXT NOT NULL,
    "room_type" TEXT,
    "name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ipro_activity_rooms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ipro_activity_messages" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "activity_room_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "external_room_id" TEXT NOT NULL,
    "external_message_id" TEXT NOT NULL,
    "room_type" TEXT,
    "author_id" TEXT,
    "author_name" TEXT,
    "content" TEXT,
    "media" JSONB,
    "mentions" JSONB,
    "has_media" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMP(3) NOT NULL,
    "received_event_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ipro_activity_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ipro_activity_documents" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_ref" TEXT NOT NULL,
    "platform" TEXT,
    "room_id" TEXT,
    "room_name" TEXT,
    "author_id" TEXT,
    "author_name" TEXT,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "has_media" BOOLEAN NOT NULL DEFAULT false,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "event_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ipro_activity_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ipro_webhook_sources_token_hash_key" ON "ipro_webhook_sources"("token_hash");
CREATE INDEX "ipro_webhook_sources_project_id_active_idx" ON "ipro_webhook_sources"("project_id", "active");

CREATE UNIQUE INDEX "ipro_webhook_receipts_project_id_event_id_key" ON "ipro_webhook_receipts"("project_id", "event_id");
CREATE INDEX "ipro_webhook_receipts_source_id_received_at_idx" ON "ipro_webhook_receipts"("source_id", "received_at");
CREATE INDEX "ipro_webhook_receipts_project_id_event_type_received_at_idx" ON "ipro_webhook_receipts"("project_id", "event_type", "received_at");

CREATE UNIQUE INDEX "ipro_activity_rooms_project_id_platform_external_room_id_key" ON "ipro_activity_rooms"("project_id", "platform", "external_room_id");
CREATE INDEX "ipro_activity_rooms_project_id_platform_idx" ON "ipro_activity_rooms"("project_id", "platform");

CREATE UNIQUE INDEX "ipro_activity_messages_project_platform_room_message_key" ON "ipro_activity_messages"("project_id", "platform", "external_room_id", "external_message_id");
CREATE INDEX "ipro_activity_messages_activity_room_id_sent_at_idx" ON "ipro_activity_messages"("activity_room_id", "sent_at");
CREATE INDEX "ipro_activity_messages_context_idx" ON "ipro_activity_messages"("project_id", "external_room_id", "sent_at", "id");
CREATE INDEX "ipro_activity_messages_project_id_author_id_idx" ON "ipro_activity_messages"("project_id", "author_id");

CREATE UNIQUE INDEX "ipro_activity_documents_project_source_ref_key" ON "ipro_activity_documents"("project_id", "source", "source_ref");
CREATE INDEX "ipro_activity_documents_project_occurred_idx" ON "ipro_activity_documents"("project_id", "occurred_at" DESC);
CREATE INDEX "ipro_activity_documents_project_source_idx" ON "ipro_activity_documents"("project_id", "source");
CREATE INDEX "ipro_activity_documents_project_platform_idx" ON "ipro_activity_documents"("project_id", "platform");
CREATE INDEX "ipro_activity_documents_project_room_idx" ON "ipro_activity_documents"("project_id", "room_id");
CREATE INDEX "ipro_activity_documents_project_author_idx" ON "ipro_activity_documents"("project_id", "author_id");
CREATE INDEX "ipro_activity_documents_project_media_occurred_idx" ON "ipro_activity_documents"("project_id", "has_media", "occurred_at" DESC);

CREATE INDEX "ipro_activity_documents_content_trgm_idx"
    ON "ipro_activity_documents" USING gin ("content" gin_trgm_ops);
CREATE INDEX "ipro_activity_documents_title_trgm_idx"
    ON "ipro_activity_documents" USING gin ((coalesce("title", '')) gin_trgm_ops);
CREATE INDEX "ipro_activity_documents_author_name_trgm_idx"
    ON "ipro_activity_documents" USING gin ((coalesce("author_name", '')) gin_trgm_ops);
CREATE INDEX "ipro_activity_documents_room_name_trgm_idx"
    ON "ipro_activity_documents" USING gin ((coalesce("room_name", '')) gin_trgm_ops);

ALTER TABLE "ipro_webhook_sources" ADD CONSTRAINT "ipro_webhook_sources_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ipro_webhook_receipts" ADD CONSTRAINT "ipro_webhook_receipts_source_id_fkey"
    FOREIGN KEY ("source_id") REFERENCES "ipro_webhook_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ipro_webhook_receipts" ADD CONSTRAINT "ipro_webhook_receipts_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ipro_activity_rooms" ADD CONSTRAINT "ipro_activity_rooms_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ipro_activity_messages" ADD CONSTRAINT "ipro_activity_messages_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ipro_activity_messages" ADD CONSTRAINT "ipro_activity_messages_activity_room_id_fkey"
    FOREIGN KEY ("activity_room_id") REFERENCES "ipro_activity_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ipro_activity_documents" ADD CONSTRAINT "ipro_activity_documents_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
