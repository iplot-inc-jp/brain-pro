# Cross-Feature RAG Index Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a searchable project-scoped RAG index that Claude generates from ten brain-pro feature areas, with manual generation controls on project pages and a searchable index screen.

**Architecture:** A single polymorphic `RagDocument` table stores overview and component summaries. Feature adapters normalize Prisma data into a common bundle, `ClaudeService` compresses it into validated JSON, and the existing background-job system performs atomic index replacement. A project-scoped REST API and shared Next.js UI expose generation, freshness, browsing, and search.

**Tech Stack:** NestJS, Prisma/PostgreSQL (`pg_trgm`), Anthropic Claude through the existing transport, QStash-backed `BackgroundJob`, Next.js/React, Jest, Vitest.

---

### Task 1: Add the RAG persistence model and migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260716010000_add_rag_documents/migration.sql`

**Step 1: Write the schema contract expected by later tests**

Add `RagFeatureType`, `RagScopeLevel`, the `RagDocument` model, `Project.ragDocuments`, and `User.generatedRagDocuments`. Use a compound unique key on `(projectId, featureType, scopeLevel, sourceKey)`.

**Step 2: Generate the migration SQL**

Create enums/table/FKs/indexes and enable `pg_trgm`. Add a GIN trigram index for `search_text` and ordinary project/filter indexes.

**Step 3: Validate Prisma**

Run: `npm --prefix backend run prisma:generate`

Expected: Prisma Client generation succeeds with `RagDocument` types.

Run: `cd backend && npx prisma validate`

Expected: `The schema at prisma/schema.prisma is valid`.

**Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260716010000_add_rag_documents/migration.sql
git commit -m "feat: add project RAG document index"
```

### Task 2: Build and validate the Claude compression contract

**Files:**
- Create: `backend/src/infrastructure/rag/rag.types.ts`
- Create: `backend/src/infrastructure/rag/rag-compression.spec.ts`
- Modify: `backend/src/infrastructure/services/claude.service.ts`
- Modify: `backend/src/infrastructure/services/llm-usage-recorder.service.ts` or its area type source if required

**Step 1: Write failing tests**

Test that the parser accepts valid fenced or plain JSON, rejects missing fields, rejects unknown/duplicate `sourceKey` values, normalizes and caps keyword arrays, and splits items by count/character budget.

**Step 2: Run the focused test and verify RED**

Run: `npm --prefix backend test -- --runInBand rag-compression.spec.ts`

Expected: FAIL because the RAG compression helpers and Claude method do not exist.

**Step 3: Implement the minimal contract**

Add `RagSourceItem`, `RagSourceBundle`, and `RagCompressedDocument`. Add pure helpers for JSON extraction, output validation, search-text building, and deterministic batching. Add `ClaudeService.compressForRag(items, apiKey, usage)` using the existing `runLlm` path and a prompt that treats source fields as untrusted data.

**Step 4: Run the test and verify GREEN**

Run: `npm --prefix backend test -- --runInBand rag-compression.spec.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add backend/src/infrastructure/rag backend/src/infrastructure/services/claude.service.ts
git commit -m "feat: add Claude RAG compression contract"
```

### Task 3: Implement feature adapters for ten areas

**Files:**
- Create: `backend/src/infrastructure/rag/rag-source.service.ts`
- Create: `backend/src/infrastructure/rag/rag-source.service.spec.ts`

**Step 1: Write failing adapter tests**

Create project-scoped Prisma stubs and assert overview/component mapping for:

- `BUSINESS_FLOW`
- `REQUIREMENT`
- `ISSUE_TREE`
- `TASK`
- `STAKEHOLDER`
- `RISK`
- `KPI`
- `SYSTEM`
- `DATA_CATALOG`
- `MEETING`

Assert stable `sourceKey`, correct `sourceUrl`, important relationships in `facts`, deterministic ordering/hash, target-ID filtering, and empty-source errors.

**Step 2: Run the focused test and verify RED**

Run: `npm --prefix backend test -- --runInBand rag-source.service.spec.ts`

Expected: FAIL because `RagSourceService` does not exist.

**Step 3: Implement the adapters**

Use one service with a feature switch and small private collectors. Every Prisma query must include `projectId` directly or traverse a project-owned parent selected with `projectId`. Normalize dates and JSON before hashing with SHA-256.

**Step 4: Run the focused test and verify GREEN**

Run: `npm --prefix backend test -- --runInBand rag-source.service.spec.ts`

Expected: PASS for all ten feature areas.

**Step 5: Commit**

```bash
git add backend/src/infrastructure/rag/rag-source.service.ts backend/src/infrastructure/rag/rag-source.service.spec.ts
git commit -m "feat: collect RAG sources across project features"
```

### Task 4: Add generation, freshness, and search services

**Files:**
- Create: `backend/src/infrastructure/rag/rag-index.service.ts`
- Create: `backend/src/infrastructure/rag/rag-index.service.spec.ts`

**Step 1: Write failing service tests**

Test:

- complete Claude output is atomically upserted;
- obsolete component rows for the same target are removed;
- a Claude failure does not call the persistence transaction;
- status reports `UNGENERATED`, `FRESH`, and `STALE` from source hashes;
- search applies the project/filter constraints and returns title/keyword boosts ahead of weaker trigram matches;
- limits are clamped.

**Step 2: Run the focused test and verify RED**

Run: `npm --prefix backend test -- --runInBand rag-index.service.spec.ts`

Expected: FAIL because `RagIndexService` does not exist.

**Step 3: Implement generation and persistence**

Resolve the current source bundle at job execution time, call Claude for overview and component batches, validate every source key, then use one Prisma transaction for upsert/delete. Store `targetKey` in metadata so targeted refreshes do not remove sibling targets.

**Step 4: Implement search**

Use parameterized `Prisma.sql` with `similarity(search_text, query)` and explicit exact/substring boosts. Never interpolate query text into raw SQL. Return a stable DTO with score and source URL.

**Step 5: Run the focused test and verify GREEN**

Run: `npm --prefix backend test -- --runInBand rag-index.service.spec.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add backend/src/infrastructure/rag/rag-index.service.ts backend/src/infrastructure/rag/rag-index.service.spec.ts
git commit -m "feat: generate and search project RAG indexes"
```

### Task 5: Wire the REST API and background job

**Files:**
- Create: `backend/src/presentation/controllers/rag.controller.ts`
- Create: `backend/src/presentation/controllers/rag.controller.spec.ts`
- Modify: `backend/src/infrastructure/services/job.service.ts`
- Modify: `backend/src/presentation/controllers/index.ts`
- Modify: `backend/src/app.module.ts`

**Step 1: Write failing controller/job tests**

Test DTO validation, edit-only generation, view access for status/list/search, project scope propagation, allowed job type, sanitized job payload, and dispatch into `RagIndexService.generate()`.

**Step 2: Run focused tests and verify RED**

Run: `npm --prefix backend test -- --runInBand rag.controller.spec.ts job.service.spec.ts`

Expected: FAIL for missing controller/job type.

**Step 3: Implement endpoints and job dispatch**

Add the four project-scoped routes from the design. Add `AI_RAG_SUMMARIZE` to allowed types and dispatch with project ID, creator ID, feature type, and optional target ID. Resolve the Anthropic key at execution time.

**Step 4: Run focused tests and verify GREEN**

Run: `npm --prefix backend test -- --runInBand rag.controller.spec.ts job.service.spec.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add backend/src/presentation/controllers/rag.controller.ts backend/src/presentation/controllers/rag.controller.spec.ts backend/src/infrastructure/services/job.service.ts backend/src/presentation/controllers/index.ts backend/src/app.module.ts
git commit -m "feat: expose project RAG generation and search API"
```

### Task 6: Add the frontend API, route registry, and shared action

**Files:**
- Create: `frontend/src/lib/rag.ts`
- Create: `frontend/src/lib/rag.test.ts`
- Create: `frontend/src/components/rag/RagSummaryAction.tsx`
- Create: `frontend/src/components/rag/RagSummaryAction.test.tsx`
- Modify: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/layout.tsx`
- Modify: `frontend/src/lib/jobs.ts`

**Step 1: Write failing route/API tests**

Test route resolution for all ten feature families and target IDs, unsupported routes, request query construction, and job type typing.

**Step 2: Run and verify RED**

Run: `npm --prefix frontend test -- --run frontend/src/lib/rag.test.ts`

Expected: FAIL because the RAG client and route registry do not exist.

**Step 3: Implement API and route registry**

Add typed generate/status/list/search functions and pathname-to-feature mapping. Keep the registry pure so it is independently testable.

**Step 4: Write failing component-state tests**

Test ungenerated, running, fresh, stale, failed, read-only, and unsupported states.

**Step 5: Implement the shared action**

Build the dialog using existing Button/Dialog/Badge conventions and `useBackgroundJob`. Mount it once in the project layout without blocking normal page rendering when status fails.

**Step 6: Run and verify GREEN**

Run: `npm --prefix frontend test -- --run frontend/src/lib/rag.test.ts frontend/src/components/rag/RagSummaryAction.test.tsx`

Expected: PASS.

**Step 7: Commit**

```bash
git add frontend/src/lib/rag.ts frontend/src/lib/rag.test.ts frontend/src/components/rag frontend/src/app/'(dashboard)'/dashboard/projects/'[projectId]'/layout.tsx frontend/src/lib/jobs.ts
git commit -m "feat: add shared RAG summary action"
```

### Task 7: Add the searchable RAG index page and navigation

**Files:**
- Create: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/rag/page.tsx`
- Create: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/rag/page.test.tsx`
- Modify: `frontend/src/app/(dashboard)/layout.tsx`

**Step 1: Write a failing page behavior test**

Test initial document listing, debounced query search, feature/scope filters, empty/error states, keyword rendering, and source links.

**Step 2: Run and verify RED**

Run: `npm --prefix frontend test -- --run frontend/src/app/'(dashboard)'/dashboard/projects/'[projectId]'/rag/page.test.tsx`

Expected: FAIL because the page does not exist.

**Step 3: Implement the page and nav item**

Add a compact two-column search/results experience using existing design tokens. Add `RAG索引` beside the knowledge tools in the project navigation.

**Step 4: Run and verify GREEN**

Run: `npm --prefix frontend test -- --run frontend/src/app/'(dashboard)'/dashboard/projects/'[projectId]'/rag/page.test.tsx`

Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/app/'(dashboard)'/dashboard/projects/'[projectId]'/rag frontend/src/app/'(dashboard)'/layout.tsx
git commit -m "feat: add searchable RAG index screen"
```

### Task 8: Verify the integrated feature

**Files:**
- Modify only files required by verification fixes

**Step 1: Run backend tests**

Run: `npm --prefix backend test -- --runInBand`

Expected: all backend tests pass.

**Step 2: Run backend build**

Run: `npm --prefix backend run build`

Expected: NestJS TypeScript build succeeds.

**Step 3: Run frontend tests**

Run: `npm --prefix frontend test -- --run`

Expected: all frontend tests pass.

**Step 4: Run frontend build**

Run: `npm --prefix frontend run build`

Expected: Next.js production build succeeds.

**Step 5: Inspect the final diff**

Run: `git status --short && git diff --check && git log --oneline -10`

Expected: no whitespace errors; only planned RAG files and commits are present.

**Step 6: Commit verification fixes if any**

```bash
git add <only-the-files-fixed-during-verification>
git commit -m "fix: harden project RAG indexing"
```
