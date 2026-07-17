-- プロンプト版管理を RAG 専用からシステム全体（機能キーごと）の管理へ一般化する。
-- 既存行は key='rag' として引き継ぐ。
ALTER TABLE "rag_prompt_versions" ADD COLUMN "key" TEXT NOT NULL DEFAULT 'rag';

DROP INDEX "rag_prompt_versions_project_version_key";
CREATE UNIQUE INDEX "rag_prompt_versions_project_key_version_key"
  ON "rag_prompt_versions"("project_id", "key", "version");

DROP INDEX "rag_prompt_versions_project_active_idx";
CREATE INDEX "rag_prompt_versions_project_key_active_idx"
  ON "rag_prompt_versions"("project_id", "key", "is_active");

-- 「アクティブ版は1つ」の制約もキー単位へ
DROP INDEX "rag_prompt_versions_one_active_per_project";
CREATE UNIQUE INDEX "rag_prompt_versions_one_active_per_project_key"
  ON "rag_prompt_versions"("project_id", "key") WHERE "is_active" = true;
