# Knowledge Library Folders Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `/dashboard/projects/:projectId/rag` をRAG・ナレッジ・チャット・リソースの横断検索に拡張し、元ファイル追跡、複数フォルダ分類、会社共有テンプレートを提供する。

**Architecture:** 元データは複製せず、新しい `KnowledgeLibraryService` が既存の5保存先を横断検索して共通結果へ正規化する。階層フォルダとpolymorphic所属、会社共有テンプレートは新規Prismaモデルで保持し、RAGのファイル出典は `RagSourceReference` で正規化する。既存RAG APIは互換性を保ち、新規 `/knowledge-library` APIを画面から利用する。

**Tech Stack:** NestJS, Prisma/PostgreSQL, Jest, Next.js 14, React, Tailwind CSS, Vitest, Testing Library

---

### Task 1: Add the knowledge library persistence model

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260717090000_knowledge_library_folders/migration.sql`
- Create: `backend/src/infrastructure/knowledge-library/knowledge-library-schema.spec.ts`

**Step 1: Write the failing schema contract test**

Read `schema.prisma` and assert that it defines:

```ts
expect(schema).toContain('model KnowledgeFolder')
expect(schema).toContain('model KnowledgeFolderItem')
expect(schema).toContain('model KnowledgeFolderTemplate')
expect(schema).toContain('model KnowledgeFolderTemplateNode')
expect(schema).toContain('model RagSourceReference')
expect(schema).toContain('@@unique([folderId, itemType, itemId]')
```

Also assert that the migration contains only additive `CREATE TYPE`, `CREATE TABLE`, `CREATE INDEX`, and `ALTER TABLE ... ADD CONSTRAINT` statements.

**Step 2: Run the test to verify RED**

Run:

```bash
cd backend && ./node_modules/.bin/jest src/infrastructure/knowledge-library/knowledge-library-schema.spec.ts --runInBand
```

Expected: FAIL because the models do not exist.

**Step 3: Add the minimal schema**

Add:

```prisma
enum KnowledgeLibraryItemType {
  RAG
  KNOWLEDGE_DOCUMENT
  KNOWLEDGE_NODE
  CHAT
  RESOURCE
}

model KnowledgeFolder {
  id        String   @id @default(cuid())
  projectId String   @map("project_id")
  parentId  String?  @map("parent_id")
  name      String
  order     Int      @default(0)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  project  Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  parent   KnowledgeFolder? @relation("KnowledgeFolderTree", fields: [parentId], references: [id], onDelete: Cascade)
  children KnowledgeFolder[] @relation("KnowledgeFolderTree")
  items    KnowledgeFolderItem[]

  @@index([projectId, parentId, order])
  @@map("knowledge_folders")
}
```

Add `KnowledgeFolderItem`, organization-scoped template and node models, and `RagSourceReference` with cascade deletion from `RagDocument`. Add inverse relations to `Project`, `Organization`, `User`, and `RagDocument`.

**Step 4: Generate Prisma Client and verify GREEN**

Run:

```bash
cd backend && ./node_modules/.bin/prisma generate --schema=prisma/schema.prisma
cd backend && ./node_modules/.bin/jest src/infrastructure/knowledge-library/knowledge-library-schema.spec.ts --runInBand
```

Expected: PASS.

**Step 5: Commit**

```bash
git add backend/prisma backend/src/infrastructure/knowledge-library/knowledge-library-schema.spec.ts
git commit -m "feat(backend): add knowledge library persistence"
```

### Task 2: Implement folder trees and company templates

**Files:**
- Create: `backend/src/infrastructure/knowledge-library/knowledge-folder.service.ts`
- Create: `backend/src/infrastructure/knowledge-library/knowledge-folder.service.spec.ts`
- Create: `backend/src/infrastructure/knowledge-library/knowledge-folder.templates.ts`
- Modify: `backend/src/app.module.ts`

**Step 1: Write failing service tests**

Cover:

```ts
it('creates a nested folder inside the requested project')
it('rejects a parent folder from another project')
it('rejects moving a folder below its own descendant')
it('adds one item to multiple folders without duplicates')
it('replaces all memberships after validating every folder and item')
it('deletes folders without deleting source items')
it('applies the same template twice without duplicate sibling folders')
it('saves the current tree as an organization template')
it('rejects templates from another organization')
```

Use a small Prisma mock that records transactions and validates the exact `projectId`/`organizationId` conditions.

**Step 2: Run tests to verify RED**

```bash
cd backend && ./node_modules/.bin/jest src/infrastructure/knowledge-library/knowledge-folder.service.spec.ts --runInBand
```

Expected: FAIL because the service is missing.

**Step 3: Implement minimal folder and template behavior**

The service must:

- trim names, reject empty names and names over 120 characters;
- calculate descendants before move and reject cycles;
- validate every item by `itemType` and `projectId` before creating memberships;
- use `$transaction` for membership replacement and template application;
- apply template nodes parent-first;
- reuse a same-name sibling using a normalized Japanese-safe comparison;
- return deletion preview `{ childCount, itemCount }` before destructive confirmation;
- expose built-in templates from a frozen code constant.

**Step 4: Verify GREEN**

```bash
cd backend && ./node_modules/.bin/jest src/infrastructure/knowledge-library/knowledge-folder.service.spec.ts --runInBand
```

Expected: PASS.

**Step 5: Commit**

```bash
git add backend/src/infrastructure/knowledge-library backend/src/app.module.ts
git commit -m "feat(backend): manage knowledge folders and templates"
```

### Task 3: Build federated knowledge search

**Files:**
- Create: `backend/src/infrastructure/knowledge-library/knowledge-library.service.ts`
- Create: `backend/src/infrastructure/knowledge-library/knowledge-library.service.spec.ts`
- Create: `backend/src/infrastructure/knowledge-library/knowledge-library.types.ts`

**Step 1: Write failing federated search tests**

Cover:

```ts
it('merges RAG, knowledge documents, nodes, chat, and resources')
it('filters by requested item types')
it('filters by folder and supports the virtual unclassified folder')
it('normalizes scores and sorts equal scores by occurredAt')
it('returns successful sources with warnings when one source fails')
it('includes every matching folder id')
it('builds direct source page and file links')
```

Expected response:

```ts
{
  items: KnowledgeSearchResult[],
  warnings: Array<{ source: KnowledgeLibraryItemType; message: string }>,
  totals: Record<string, number>,
}
```

**Step 2: Run tests to verify RED**

```bash
cd backend && ./node_modules/.bin/jest src/infrastructure/knowledge-library/knowledge-library.service.spec.ts --runInBand
```

Expected: FAIL because the search service is missing.

**Step 3: Implement minimal concurrent search**

Use `Promise.allSettled` for independent source queries. Query at most 50 candidates per selected source, normalize each score to `0..1`, merge, attach memberships, then apply the final limit. Never expose a row without the caller project ID in its query condition.

Source mapping:

- RAG: existing title/summary/content/keywords and `RagSourceReference[]`;
- KnowledgeDocument: title/summary/contentText and `blobUrl`;
- KnowledgeNode: label/description and its detail route;
- CHAT: `ipro_activity_documents.source = 'chat'`;
- RESOURCE: known non-chat source list used by activity history.

**Step 4: Verify GREEN**

```bash
cd backend && ./node_modules/.bin/jest src/infrastructure/knowledge-library/knowledge-library.service.spec.ts --runInBand
```

Expected: PASS.

**Step 5: Commit**

```bash
git add backend/src/infrastructure/knowledge-library
git commit -m "feat(backend): search the knowledge library"
```

### Task 4: Preserve RAG file provenance

**Files:**
- Modify: `backend/src/infrastructure/rag/rag.types.ts`
- Modify: `backend/src/infrastructure/rag/rag-source.service.ts`
- Modify: `backend/src/infrastructure/rag/rag-index.service.ts`
- Modify: `backend/src/infrastructure/rag/rag-source.service.spec.ts`
- Modify: `backend/src/infrastructure/rag/rag-index.service.spec.ts`

**Step 1: Write failing provenance tests**

Add tests proving that:

- a meeting document produces its Google Docs URL as a source file;
- task and business-flow attachments produce authenticated `/api/attachments/:id/file` references;
- RAG upsert replaces stale `RagSourceReference` rows in the same transaction;
- structured records without files retain only `sourceUrl`.

**Step 2: Run tests to verify RED**

```bash
cd backend && ./node_modules/.bin/jest src/infrastructure/rag/rag-source.service.spec.ts src/infrastructure/rag/rag-index.service.spec.ts --runInBand
```

Expected: FAIL because `sourceFiles` and reference persistence are absent.

**Step 3: Implement minimal provenance collection**

Extend `RagSourceItem` with a bounded, deduplicated `sourceFiles` array. Include required attachment relations only for feature types that support them. During generation, replace references after each RAG document upsert inside the existing transaction.

**Step 4: Verify GREEN**

Run the same Jest command. Expected: PASS.

**Step 5: Commit**

```bash
git add backend/src/infrastructure/rag
git commit -m "feat(backend): preserve RAG source files"
```

### Task 5: Expose project-scoped library APIs

**Files:**
- Create: `backend/src/presentation/controllers/knowledge-library.controller.ts`
- Create: `backend/src/presentation/controllers/knowledge-library.controller.spec.ts`
- Create: `backend/src/presentation/dto/knowledge-library/index.ts`
- Modify: `backend/src/app.module.ts`

**Step 1: Write failing controller tests**

Test the exact routes and delegation for:

```text
GET    /projects/:projectId/knowledge-library/search
GET    /projects/:projectId/knowledge-folders
POST   /projects/:projectId/knowledge-folders
PATCH  /projects/:projectId/knowledge-folders/:folderId
GET    /projects/:projectId/knowledge-folders/:folderId/delete-preview
DELETE /projects/:projectId/knowledge-folders/:folderId
PUT    /projects/:projectId/knowledge-library/items/:itemType/:itemId/folders
POST   /projects/:projectId/knowledge-folders/:folderId/items
GET    /projects/:projectId/knowledge-folder-templates
POST   /projects/:projectId/knowledge-folder-templates
PATCH  /projects/:projectId/knowledge-folder-templates/:templateId
DELETE /projects/:projectId/knowledge-folder-templates/:templateId
POST   /projects/:projectId/knowledge-folder-templates/:templateId/apply
```

**Step 2: Run tests to verify RED**

```bash
cd backend && ./node_modules/.bin/jest src/presentation/controllers/knowledge-library.controller.spec.ts --runInBand
```

Expected: FAIL because the controller is missing.

**Step 3: Implement DTO validation and controller**

Use `@ProjectScopedAccess()` and `ProjectAccessGuard`; GET requires view and mutations require edit through the guard's existing HTTP-method policy. Validate item types, limits, folder name length, arrays, and template names. Resolve the project's organization inside the service before template access.

**Step 4: Verify GREEN and nearby backend tests**

```bash
cd backend && ./node_modules/.bin/jest src/presentation/controllers/knowledge-library.controller.spec.ts src/infrastructure/knowledge-library src/infrastructure/rag --runInBand
```

Expected: PASS.

**Step 5: Commit**

```bash
git add backend/src/presentation backend/src/app.module.ts
git commit -m "feat(backend): expose knowledge library APIs"
```

### Task 6: Add the frontend library client and tree state

**Files:**
- Create: `frontend/src/lib/knowledge-library.ts`
- Create: `frontend/src/lib/knowledge-library.test.ts`

**Step 1: Write failing client and pure-state tests**

Test:

- search query serialization for q/types/folder/unclassified/limit;
- auth headers and encoded project/item IDs;
- folder tree stable sorting and orphan visibility;
- descendant calculation for move validation;
- optimistic membership replace and rollback helper;
- built-in/custom template result normalization.

**Step 2: Run tests to verify RED**

```bash
cd frontend && ./node_modules/.bin/vitest run src/lib/knowledge-library.test.ts
```

Expected: FAIL because the client is missing.

**Step 3: Implement the client and pure helpers**

Follow the existing `accessToken` and `read()` conventions in `src/lib/rag.ts`. Keep network calls separate from pure tree and optimistic-state functions.

**Step 4: Verify GREEN**

Run the same Vitest command. Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/lib/knowledge-library.ts frontend/src/lib/knowledge-library.test.ts
git commit -m "feat(frontend): add knowledge library client"
```

### Task 7: Expand the RAG page into federated search

**Files:**
- Modify: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/rag/page.tsx`
- Create: `frontend/src/components/rag/knowledge-search-results.tsx`
- Create: `frontend/src/components/rag/knowledge-search-results.test.tsx`

**Step 1: Write failing interaction tests**

Test:

- source tabs `すべて / RAG / ナレッジ / チャット / リソース`;
- mixed result rendering with distinct type labels;
- source page and source file links;
- folder badges;
- partial-source warnings without hiding results;
- empty, loading, and full error states;
- current feature/scope filters remain available for RAG results.

**Step 2: Run tests to verify RED**

```bash
cd frontend && ./node_modules/.bin/vitest run src/components/rag/knowledge-search-results.test.tsx
```

Expected: FAIL because the component does not exist.

**Step 3: Implement the refined editorial search UI**

Keep the existing light, index-like visual language. Use type tabs as a compact ruled navigation, source links as explicit secondary actions, and provenance as progressive disclosure. Avoid card grids; preserve the dense searchable list.

**Step 4: Verify GREEN and existing RAG tests**

```bash
cd frontend && ./node_modules/.bin/vitest run src/components/rag/knowledge-search-results.test.tsx src/lib/rag-search-state.test.ts src/lib/rag.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add 'frontend/src/app/(dashboard)/dashboard/projects/[projectId]/rag/page.tsx' frontend/src/components/rag
git commit -m "feat(frontend): search all project knowledge"
```

### Task 8: Build the folder workspace and template UI

**Files:**
- Create: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/knowledge/folders/page.tsx`
- Create: `frontend/src/components/knowledge-library/knowledge-folder-workspace.tsx`
- Create: `frontend/src/components/knowledge-library/knowledge-folder-workspace.test.tsx`
- Create: `frontend/src/components/knowledge-library/folder-template-menu.tsx`
- Create: `frontend/src/components/knowledge-library/folder-template-menu.test.tsx`

**Step 1: Write failing workspace tests**

Test:

- folder tree and virtual unclassified node;
- create child, rename, move, delete preview and confirm;
- drag adds a membership without removing existing memberships;
- multi-select and multi-folder assignment;
- inspector checkbox editing with rollback on failure;
- built-in template application;
- save current tree as company template;
- custom template rename/delete;
- desktop three-pane and mobile drawer semantics.

**Step 2: Run tests to verify RED**

```bash
cd frontend && ./node_modules/.bin/vitest run src/components/knowledge-library
```

Expected: FAIL because the components are missing.

**Step 3: Implement the workspace**

Use a purposeful document-library aesthetic: narrow tree rail, dense central index, quiet provenance inspector, amber selection marker, and strong text hierarchy. Use native drag events with keyboard-accessible `分類する` controls as the equivalent path. Do not hide any critical action on mobile.

**Step 4: Verify GREEN**

Run the same Vitest command. Expected: PASS.

**Step 5: Commit**

```bash
git add 'frontend/src/app/(dashboard)/dashboard/projects/[projectId]/knowledge/folders/page.tsx' frontend/src/components/knowledge-library
git commit -m "feat(frontend): add knowledge folder workspace"
```

### Task 9: Add navigation and complete verification

**Files:**
- Modify: `frontend/src/lib/knowledge-navigation.ts`
- Modify: `frontend/src/lib/knowledge-navigation.test.ts`
- Modify: `docs/plans/2026-07-17-knowledge-library-folders-design.md` only if implementation-specific clarifications are required

**Step 1: Write the failing navigation assertion**

Assert `フォルダ` appears after `リソース履歴` and points to `/knowledge/folders`.

**Step 2: Run to verify RED**

```bash
cd frontend && ./node_modules/.bin/vitest run src/lib/knowledge-navigation.test.ts
```

Expected: FAIL because the item is absent.

**Step 3: Add the navigation item and verify GREEN**

Use `FolderTree` from `lucide-react`. Run the same test and expect PASS.

**Step 4: Run full verification**

```bash
cd backend && ./node_modules/.bin/jest src/infrastructure/knowledge-library src/infrastructure/rag src/presentation/controllers/knowledge-library.controller.spec.ts src/presentation/controllers/rag.controller.spec.ts --runInBand
cd backend && ./node_modules/.bin/nest build
cd frontend && ./node_modules/.bin/vitest run
cd frontend && ./node_modules/.bin/next build
git diff --check
git status --short
```

Expected: all tests and both builds pass; no whitespace errors; only intended files changed.

**Step 5: Commit**

```bash
git add frontend/src/lib/knowledge-navigation.ts frontend/src/lib/knowledge-navigation.test.ts
git commit -m "feat(frontend): add knowledge folders navigation"
```

**Step 6: Finish the branch**

Use @requesting-code-review, @verification-before-completion, and @finishing-a-development-branch. The current session forbids subagents, so apply the review checklist directly. Merge and deployment require the user's existing authorization to remain in force; otherwise present the finishing options.
