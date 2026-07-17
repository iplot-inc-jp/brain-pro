CREATE TYPE "KnowledgeLibraryItemType" AS ENUM ('RAG', 'KNOWLEDGE_DOCUMENT', 'KNOWLEDGE_NODE', 'CHAT', 'RESOURCE');
CREATE TYPE "RagSourceReferenceKind" AS ENUM ('FILE', 'EXTERNAL');

CREATE TABLE "knowledge_folders" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "knowledge_folders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_folder_items" (
    "id" TEXT NOT NULL,
    "folder_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "item_type" "KnowledgeLibraryItemType" NOT NULL,
    "item_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_folder_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_folder_templates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "knowledge_folder_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_folder_template_nodes" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "parent_node_id" TEXT,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_folder_template_nodes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rag_source_references" (
    "id" TEXT NOT NULL,
    "rag_document_id" TEXT NOT NULL,
    "kind" "RagSourceReferenceKind" NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT,
    "mime_type" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rag_source_references_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "knowledge_folders_id_project_id_key" ON "knowledge_folders"("id", "project_id");
CREATE INDEX "knowledge_folders_project_id_parent_id_order_idx" ON "knowledge_folders"("project_id", "parent_id", "order");
CREATE UNIQUE INDEX "knowledge_folder_items_folder_type_item_key" ON "knowledge_folder_items"("folder_id", "item_type", "item_id");
CREATE INDEX "knowledge_folder_items_project_id_item_type_item_id_idx" ON "knowledge_folder_items"("project_id", "item_type", "item_id");
CREATE UNIQUE INDEX "knowledge_folder_templates_organization_id_name_key" ON "knowledge_folder_templates"("organization_id", "name");
CREATE INDEX "knowledge_folder_templates_organization_id_updated_at_idx" ON "knowledge_folder_templates"("organization_id", "updated_at");
CREATE INDEX "knowledge_folder_template_nodes_template_id_parent_node_id_order_idx" ON "knowledge_folder_template_nodes"("template_id", "parent_node_id", "order");
CREATE UNIQUE INDEX "rag_source_references_rag_document_id_url_key" ON "rag_source_references"("rag_document_id", "url");
CREATE INDEX "rag_source_references_rag_document_id_order_idx" ON "rag_source_references"("rag_document_id", "order");

ALTER TABLE "knowledge_folders" ADD CONSTRAINT "knowledge_folders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_folders" ADD CONSTRAINT "knowledge_folders_parent_id_project_id_fkey" FOREIGN KEY ("parent_id", "project_id") REFERENCES "knowledge_folders"("id", "project_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_folder_items" ADD CONSTRAINT "knowledge_folder_items_folder_id_project_id_fkey" FOREIGN KEY ("folder_id", "project_id") REFERENCES "knowledge_folders"("id", "project_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_folder_templates" ADD CONSTRAINT "knowledge_folder_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_folder_templates" ADD CONSTRAINT "knowledge_folder_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "knowledge_folder_template_nodes" ADD CONSTRAINT "knowledge_folder_template_nodes_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "knowledge_folder_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_folder_template_nodes" ADD CONSTRAINT "knowledge_folder_template_nodes_parent_node_id_fkey" FOREIGN KEY ("parent_node_id") REFERENCES "knowledge_folder_template_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rag_source_references" ADD CONSTRAINT "rag_source_references_rag_document_id_fkey" FOREIGN KEY ("rag_document_id") REFERENCES "rag_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
