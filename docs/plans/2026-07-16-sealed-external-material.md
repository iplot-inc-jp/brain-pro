# Sealed External Material Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Seal verified chat material bytes into immutable private storage and make polling recover interrupted deterministic jobs.

**Architecture:** Keep direct uploads on mutable staging paths. After verification, copy the exact verified buffer to a content-addressed server-only sealed path and persist only that sealed reference. Status polling drives existing durable jobs according to import state.

**Tech Stack:** NestJS, Prisma, Vercel Blob 2.6, Jest, pdf-lib, bounded OOXML validator

---

### Task 1: Immutable private seal

**Files:**
- Modify: `backend/src/infrastructure/services/blob-storage.service.ts`
- Test: `backend/src/infrastructure/services/blob-storage.service.private.spec.ts`

1. Add a failing test for private PUT with `addRandomSuffix:false` and `allowOverwrite:false`, plus safe reuse after an already-exists response.
2. Run the focused Blob test and confirm the missing seal method failure.
3. Implement `sealPrivate` using the dedicated private token and exact verified bytes.
4. Run the focused test to GREEN.

### Task 2: Persist only sealed content

**Files:**
- Modify: `backend/src/application/use-cases/ingestion/import-external-material.use-case.ts`
- Test: `backend/src/application/use-cases/ingestion/import-external-material.use-case.spec.ts`

1. Add failing TOCTOU, concurrent/retry seal, staging cleanup, and BATCHED-only download tests.
2. Run the focused use-case test and confirm expected staging-reference failures.
3. Derive a content-addressed sealed pathname, seal after validation, and pass only its opaque reference into transactional artifacts.
4. Make download derive the sealed pathname and reject non-BATCHED imports.
5. Run the focused use-case test to GREEN.

### Task 3: Poll self-healing

**Files:**
- Modify: `backend/src/application/use-cases/ingestion/import-external-material.use-case.ts`
- Test: `backend/src/application/use-cases/ingestion/import-external-material.use-case.spec.ts`

1. Add failing tests proving `STORED` poll starts/recovers verifier and `BATCHED` poll starts/recovers root.
2. Run focused tests to verify RED.
3. Add state-driven recovery to `getStatus` without creating new job IDs.
4. Run focused tests to GREEN.

### Task 4: Public route hardening

**Files:**
- Modify: `backend/src/presentation/controllers/attachment.controller.ts`
- Test: `backend/src/presentation/controllers/attachment.controller.external-material.spec.ts`

1. Add a failing test for a private reference with an edited/non-private folder.
2. Reject either external folder or private reference before response headers.
3. Run the focused controller test to GREEN.

### Task 5: Verification and commit

1. Run focused suites.
2. Run full backend tests, build, TypeScript, Prisma validate, and `git diff --check`.
3. Commit the verified changes.
