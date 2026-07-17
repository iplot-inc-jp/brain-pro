import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = readFileSync(
  resolve(__dirname, '../../../prisma/schema.prisma'),
  'utf8',
);
const migrationPath = resolve(
  __dirname,
  '../../../prisma/migrations/20260717090000_knowledge_library_folders/migration.sql',
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';

describe('knowledge library persistence contract', () => {
  it('defines folders, polymorphic memberships, shared templates, and RAG sources', () => {
    expect(schema).toContain('enum KnowledgeLibraryItemType');
    expect(schema).toContain('model KnowledgeFolder {');
    expect(schema).toContain('model KnowledgeFolderItem {');
    expect(schema).toContain('model KnowledgeFolderTemplate {');
    expect(schema).toContain('model KnowledgeFolderTemplateNode {');
    expect(schema).toContain('model RagSourceReference {');
    expect(schema).toContain('@@unique([folderId, itemType, itemId]');
  });

  it('ships an additive migration with tenant and tree indexes', () => {
    expect(migration).toContain('CREATE TYPE "KnowledgeLibraryItemType"');
    expect(migration).toContain('CREATE TABLE "knowledge_folders"');
    expect(migration).toContain('CREATE TABLE "knowledge_folder_items"');
    expect(migration).toContain('CREATE TABLE "knowledge_folder_templates"');
    expect(migration).toContain('CREATE TABLE "knowledge_folder_template_nodes"');
    expect(migration).toContain('CREATE TABLE "rag_source_references"');
    expect(migration).not.toMatch(/^\s*(DROP\b|DELETE\s+FROM\b|UPDATE\s+.+\s+SET\b)/im);
  });
});
