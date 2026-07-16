CREATE TABLE "rag_prompt_versions" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "model" TEXT NOT NULL,
  "system_prompt" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rag_prompt_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rag_prompt_versions_project_version_key"
  ON "rag_prompt_versions"("project_id", "version");
CREATE INDEX "rag_prompt_versions_project_active_idx"
  ON "rag_prompt_versions"("project_id", "is_active");
CREATE UNIQUE INDEX "rag_prompt_versions_one_active_per_project"
  ON "rag_prompt_versions"("project_id") WHERE "is_active" = true;

ALTER TABLE "rag_prompt_versions"
  ADD CONSTRAINT "rag_prompt_versions_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rag_prompt_versions"
  ADD CONSTRAINT "rag_prompt_versions_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "llm_usage_logs" ADD COLUMN "prompt_version_id" TEXT;
CREATE INDEX "llm_usage_logs_prompt_version_id_idx"
  ON "llm_usage_logs"("prompt_version_id");
ALTER TABLE "llm_usage_logs"
  ADD CONSTRAINT "llm_usage_logs_prompt_version_id_fkey"
  FOREIGN KEY ("prompt_version_id") REFERENCES "rag_prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
