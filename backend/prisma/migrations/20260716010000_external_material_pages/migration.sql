-- External chat material import state and resumable page-level extraction.
CREATE TYPE "ExternalMaterialImportStatus" AS ENUM ('PENDING', 'STORED', 'BATCHED', 'FAILED');
CREATE TYPE "KnowledgePageKind" AS ENUM ('PDF_PAGE', 'PPTX_SLIDE');
CREATE TYPE "KnowledgePageStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- Existing jobs remain roots (parent_job_id = NULL). Page extraction jobs can
-- point at a file-level orchestrator job without coupling their lifecycle.
ALTER TABLE "background_jobs" ADD COLUMN "parent_job_id" TEXT;

CREATE TABLE "ExternalMaterialImport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "attachmentId" TEXT,
    "ingestionBatchId" TEXT,
    "sourcePlatform" TEXT NOT NULL,
    "sourceChannelId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "status" "ExternalMaterialImportStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalMaterialImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeDocumentPage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ingestionFileId" TEXT NOT NULL,
    "knowledgeDocumentId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "pageKind" "KnowledgePageKind" NOT NULL,
    "sourceText" TEXT,
    "sourceBlobUrl" TEXT,
    "contentText" TEXT,
    "summary" TEXT,
    "extractionResult" JSONB,
    "status" "KnowledgePageStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocumentPage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "background_jobs_parent_job_id_idx" ON "background_jobs"("parent_job_id");

CREATE UNIQUE INDEX "ExternalMaterialImport_projectId_idempotencyKey_key"
    ON "ExternalMaterialImport"("projectId", "idempotencyKey");
CREATE INDEX "ExternalMaterialImport_projectId_status_idx"
    ON "ExternalMaterialImport"("projectId", "status");
CREATE INDEX "ExternalMaterialImport_attachmentId_idx"
    ON "ExternalMaterialImport"("attachmentId");
CREATE INDEX "ExternalMaterialImport_ingestionBatchId_idx"
    ON "ExternalMaterialImport"("ingestionBatchId");

CREATE UNIQUE INDEX "KnowledgeDocumentPage_ingestionFileId_pageNumber_key"
    ON "KnowledgeDocumentPage"("ingestionFileId", "pageNumber");
CREATE INDEX "KnowledgeDocumentPage_knowledgeDocumentId_pageNumber_idx"
    ON "KnowledgeDocumentPage"("knowledgeDocumentId", "pageNumber");
CREATE INDEX "KnowledgeDocumentPage_status_idx"
    ON "KnowledgeDocumentPage"("status");

ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_parent_job_id_fkey"
    FOREIGN KEY ("parent_job_id") REFERENCES "background_jobs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ExternalMaterialImport" ADD CONSTRAINT "ExternalMaterialImport_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalMaterialImport" ADD CONSTRAINT "ExternalMaterialImport_attachmentId_fkey"
    FOREIGN KEY ("attachmentId") REFERENCES "attachments"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExternalMaterialImport" ADD CONSTRAINT "ExternalMaterialImport_ingestionBatchId_fkey"
    FOREIGN KEY ("ingestionBatchId") REFERENCES "IngestionBatch"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KnowledgeDocumentPage" ADD CONSTRAINT "KnowledgeDocumentPage_knowledgeDocumentId_fkey"
    FOREIGN KEY ("knowledgeDocumentId") REFERENCES "KnowledgeDocument"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
