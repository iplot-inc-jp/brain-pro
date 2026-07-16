# RAG AI Governance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Store the RAG Claude model and system prompt as project-scoped immutable DB versions, expose them in the project sidebar, and connect every RAG usage record to the prompt version used.

**Architecture:** Add a versioned `RagPromptVersion` model and an optional relation from `LlmUsageLog`. A `RagPromptService` owns default creation, active-version resolution, validation, and atomic version changes. RAG generation resolves one active configuration before batching and passes its model, prompt, and version through Claude compression, usage logging, and indexed documents. Existing AI usage reporting is extended rather than replaced.

**Tech Stack:** Prisma/PostgreSQL, NestJS, existing Claude transport and background jobs, Next.js/React, Jest, Vitest.

---

### Task 1: Add prompt-version persistence

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260719000000_add_rag_prompt_versions/migration.sql`

**Step 1: Add the schema contract**

Add `RagPromptVersion` with `id`, `projectId`, `version`, `model`, `systemPrompt`, `isActive`, `createdById`, and timestamps. Add project/user relations and `@@unique([projectId, version])`. Add nullable `promptVersionId` and relation to `LlmUsageLog`.

**Step 2: Write the migration**

Create the table, foreign keys, project/version unique index, partial unique index for one active row per project, and the nullable usage-log foreign key/index.

**Step 3: Validate Prisma**

Run: `DATABASE_URL=postgresql://user:pass@localhost:5432/brainpro npx prisma validate`

Expected: schema is valid.

**Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260719000000_add_rag_prompt_versions/migration.sql
git commit -m "feat: add versioned RAG prompt settings"
```

### Task 2: Implement versioned RAG settings

**Files:**
- Create: `backend/src/infrastructure/rag/rag-prompt.defaults.ts`
- Create: `backend/src/infrastructure/rag/rag-prompt.service.ts`
- Create: `backend/src/infrastructure/rag/rag-prompt.service.spec.ts`
- Modify: `backend/src/app.module.ts`

**Step 1: Write failing service tests**

Test that:

- `getActive()` creates version 1 with the safe default prompt when no row exists;
- repeated reads return the same row;
- `update()` validates model/prompt and creates version N+1 while retaining the old row;
- active-row switching is done in one transaction;
- `reset()` creates a new version using defaults;
- history is newest first;
- concurrent version conflicts produce a clear conflict error.

**Step 2: Run RED**

Run: `npm test -- --runInBand src/infrastructure/rag/rag-prompt.service.spec.ts`

Expected: FAIL because the service does not exist.

**Step 3: Implement defaults and service**

Export the current hardened system prompt and allowed models from `rag-prompt.defaults.ts`. Implement `getActive`, `getSettings`, `update`, and `reset`. Require a non-empty prompt of at most 20,000 characters and an allowed model. Keep all project filters explicit.

**Step 4: Run GREEN**

Run the focused test and expect all cases to pass.

**Step 5: Commit**

```bash
git add backend/src/infrastructure/rag backend/src/app.module.ts
git commit -m "feat: manage project RAG prompt versions"
```

### Task 3: Use DB settings during generation and usage recording

**Files:**
- Modify: `backend/src/infrastructure/services/llm-usage-recorder.service.ts`
- Modify: `backend/src/infrastructure/services/llm-usage-recorder.service.spec.ts`
- Modify: `backend/src/infrastructure/services/claude.service.ts`
- Modify: `backend/src/infrastructure/rag/claude-rag.service.spec.ts`
- Modify: `backend/src/infrastructure/rag/rag-index.service.ts`
- Modify: `backend/src/infrastructure/rag/rag-index.service.spec.ts`

**Step 1: Write failing integration-contract tests**

Assert that `compressForRag` accepts explicit `{ model, systemPrompt, promptVersionId }`, passes model/prompt to the transport, and records the version ID. Assert that `RagIndexService.generate` resolves settings once, uses them for every batch, and stores the version ID in every `RagDocument.promptVersion`.

**Step 2: Run RED**

Run the three focused suites and confirm failures are caused by the missing setting flow.

**Step 3: Implement minimal propagation**

Extend `LlmUsageContext` with optional `promptVersionId`; persist it in `LlmUsageRecorder`. Inject `RagPromptService` into `RagIndexService`, resolve the active setting before any Claude call, and pass the same values across all batches. Remove the RAG prompt/model fallback from `ClaudeService.compressForRag`.

**Step 4: Run GREEN and build backend**

Run focused suites, then `npm run build`.

**Step 5: Commit**

```bash
git add backend/src/infrastructure/services backend/src/infrastructure/rag
git commit -m "feat: trace RAG generation to prompt versions"
```

### Task 4: Expose project-scoped RAG settings API

**Files:**
- Modify: `backend/src/presentation/controllers/rag.controller.ts`
- Modify: `backend/src/presentation/controllers/rag.controller.spec.ts`

**Step 1: Write failing controller tests**

Test GET settings, PUT settings, and POST reset delegation with project/user scope. Test invalid model, empty prompt, and overlong prompt DTO validation. Confirm the existing project guard gives GET view access and mutation edit access.

**Step 2: Run RED**

Run: `npm test -- --runInBand src/presentation/controllers/rag.controller.spec.ts`

Expected: FAIL for missing endpoints.

**Step 3: Implement endpoints**

Inject `RagPromptService`. Add Swagger DTOs and endpoints under `/projects/:projectId/rag/settings`. Return `{ active, history, defaults, allowedModels }` from GET.

**Step 4: Run GREEN**

Run controller tests and backend build.

**Step 5: Commit**

```bash
git add backend/src/presentation/controllers/rag.controller.ts backend/src/presentation/controllers/rag.controller.spec.ts
git commit -m "feat: expose RAG prompt settings API"
```

### Task 5: Extend usage reporting with prompt versions

**Files:**
- Modify: `backend/src/application/use-cases/llm-usage/llm-usage.output.ts`
- Modify: `backend/src/application/use-cases/llm-usage/get-llm-usage-summary.use-case.ts`
- Modify: `backend/src/application/use-cases/llm-usage/get-llm-usage-summary.use-case.spec.ts`
- Modify: `frontend/src/lib/llm-usage.ts`
- Modify: `frontend/src/lib/llm-usage.test.ts`

**Step 1: Write failing reporting tests**

Assert that recent RAG calls include prompt-version ID, version number, and prompt model metadata while legacy calls return null. Add frontend tests for the `RAG` label and response typing/presentation helper.

**Step 2: Run RED**

Run the focused Jest and Vitest suites.

**Step 3: Implement reporting**

Include `promptVersion` in the Prisma query relation and map it into recent call output. Add `RAG: 'RAG索引生成'` to the frontend area union and label map.

**Step 4: Run GREEN**

Run both focused suites.

**Step 5: Commit**

```bash
git add backend/src/application/use-cases/llm-usage frontend/src/lib/llm-usage.ts frontend/src/lib/llm-usage.test.ts
git commit -m "feat: show RAG prompt versions in AI usage"
```

### Task 6: Add the RAG settings frontend and navigation

**Files:**
- Create: `frontend/src/lib/rag-settings.ts`
- Create: `frontend/src/lib/rag-settings.test.ts`
- Create: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/rag/settings/page.tsx`
- Create: `frontend/src/components/rag/rag-settings-state.ts`
- Create: `frontend/src/components/rag/rag-settings-state.test.ts`
- Modify: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/ai-usage/page.tsx`
- Modify: `frontend/src/app/(dashboard)/layout.tsx`
- Modify: `frontend/src/lib/rag.ts`

**Step 1: Write failing API/state tests**

Test authenticated GET/PUT/reset requests, immutable version labels, dirty-state detection, model/prompt validation, and read-only disabling. Test that `/rag/settings` does not show the floating RAG generation action.

**Step 2: Run RED**

Run focused Vitest suites and confirm missing modules/behavior.

**Step 3: Implement frontend API and state helpers**

Add typed settings/history clients and pure form-state helpers.

**Step 4: Implement settings page and usage display**

Build the editor with existing page header, cards, inputs, select, read-only context, save/reset feedback, and version history. Show `vN` beside recent RAG usage calls. Add `RAG設定` under the sidebar Settings group.

**Step 5: Run GREEN and build frontend**

Run focused tests and `npm run build`.

**Step 6: Commit**

```bash
git add frontend/src/lib frontend/src/components/rag frontend/src/app/'(dashboard)'/dashboard/projects/'[projectId]'/rag frontend/src/app/'(dashboard)'/dashboard/projects/'[projectId]'/ai-usage/page.tsx frontend/src/app/'(dashboard)'/layout.tsx
git commit -m "feat: add RAG prompt management screen"
```

### Task 7: Verify the integrated feature

**Files:**
- Modify only files required by verification fixes

**Step 1: Validate database and backend**

Run Prisma validation, all backend tests with network access where required, and backend build.

**Step 2: Verify frontend**

Run all RAG/settings/usage focused tests, the full frontend suite, and production build. Keep the pre-existing manual-content fixture failure explicitly separated if still present.

**Step 3: Verify MCP compatibility**

Run `node --test tools/rag.test.mjs`; existing `rag_generate` and `rag_search` must continue working without prompt fields in their payloads.

**Step 4: Inspect final diff**

Run `git status --short`, `git diff --check`, and inspect commits/files against the approved design.

**Step 5: Commit verification fixes if needed**
