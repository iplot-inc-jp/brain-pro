-- 機能横断 RAG 索引。日本語の部分一致にも使える trigram を有効化する。
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE TYPE "RagFeatureType" AS ENUM (
  'BUSINESS_FLOW',
  'REQUIREMENT',
  'ISSUE_TREE',
  'TASK',
  'STAKEHOLDER',
  'RISK',
  'KPI',
  'SYSTEM',
  'DATA_CATALOG',
  'MEETING'
);

CREATE TYPE "RagScopeLevel" AS ENUM ('OVERVIEW', 'COMPONENT');

ALTER TYPE "LlmUsageArea" ADD VALUE 'RAG';

CREATE TABLE "rag_documents" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "feature_type" "RagFeatureType" NOT NULL,
  "scope_level" "RagScopeLevel" NOT NULL,
  "target_key" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "source_url" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "keywords" JSONB NOT NULL DEFAULT '[]',
  "aliases" JSONB NOT NULL DEFAULT '[]',
  "questions" JSONB NOT NULL DEFAULT '[]',
  "search_text" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "source_hash" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "prompt_version" TEXT NOT NULL,
  "generated_by_id" TEXT,
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "rag_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rag_docs_project_feature_scope_source_key"
  ON "rag_documents"("project_id", "feature_type", "scope_level", "source_key");
CREATE INDEX "rag_docs_project_feature_target_idx"
  ON "rag_documents"("project_id", "feature_type", "target_key");
CREATE INDEX "rag_docs_project_scope_idx"
  ON "rag_documents"("project_id", "scope_level");
CREATE INDEX "rag_docs_search_text_trgm_idx"
  ON "rag_documents" USING GIN ("search_text" gin_trgm_ops);

ALTER TABLE "rag_documents"
  ADD CONSTRAINT "rag_documents_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rag_documents"
  ADD CONSTRAINT "rag_documents_generated_by_id_fkey"
  FOREIGN KEY ("generated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
