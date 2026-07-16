import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = readFileSync(
  resolve(__dirname, '../../../prisma/schema.prisma'),
  'utf8',
);
const migration = readFileSync(
  resolve(
    __dirname,
    '../../../prisma/migrations/20260716010000_external_material_pages/migration.sql',
  ),
  'utf8',
);

function model(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`Model ${name} not found`);
  return match[0];
}

describe('knowledge page schema and migration contract', () => {
  it('owns one direct child job and clears the pointer when that job is deleted', () => {
    expect(model('BackgroundJob')).toMatch(
      /knowledgePage\s+KnowledgeDocumentPage\?\s+@relation\("KnowledgePageJob"\)/,
    );
    expect(model('KnowledgeDocumentPage')).toMatch(
      /jobId\s+String\?\s+@unique/,
    );
    expect(model('KnowledgeDocumentPage')).toMatch(
      /job\s+BackgroundJob\?\s+@relation\("KnowledgePageJob", fields: \[jobId\], references: \[id\], onDelete: SetNull\)/,
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "KnowledgeDocumentPage_jobId_key"',
    );
    expect(migration).toContain(
      'CONSTRAINT "KnowledgeDocumentPage_jobId_fkey"',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("jobId") REFERENCES "background_jobs"("id")\n    ON DELETE SET NULL ON UPDATE CASCADE',
    );
  });

  it('binds each page to same-project document and ingestion-file parents', () => {
    expect(model('IngestionFile')).toMatch(/pages\s+KnowledgeDocumentPage\[\]/);
    expect(model('IngestionFile')).toContain('@@unique([id, projectId])');
    expect(model('KnowledgeDocument')).toMatch(
      /pages\s+KnowledgeDocumentPage\[\]/,
    );
    expect(model('KnowledgeDocument')).toContain('@@unique([id, projectId])');

    const page = model('KnowledgeDocumentPage');
    expect(page).toMatch(
      /ingestionFile\s+IngestionFile\s+@relation\(fields: \[ingestionFileId, projectId\], references: \[id, projectId\], onDelete: Cascade\)/,
    );
    expect(page).toMatch(
      /document\s+KnowledgeDocument\s+@relation\(fields: \[knowledgeDocumentId, projectId\], references: \[id, projectId\], onDelete: Cascade\)/,
    );

    expect(migration).toContain(
      'CREATE UNIQUE INDEX "IngestionFile_id_projectId_key"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "KnowledgeDocument_id_projectId_key"',
    );
    expect(migration).toContain(
      'CONSTRAINT "KnowledgeDocumentPage_ingestionFileId_projectId_fkey"',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("ingestionFileId", "projectId") REFERENCES "IngestionFile"("id", "projectId")\n    ON DELETE CASCADE ON UPDATE CASCADE',
    );
    expect(migration).toContain(
      'CONSTRAINT "KnowledgeDocumentPage_knowledgeDocumentId_projectId_fkey"',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("knowledgeDocumentId", "projectId") REFERENCES "KnowledgeDocument"("id", "projectId")\n    ON DELETE CASCADE ON UPDATE CASCADE',
    );
  });
});
