# ipro-db Generic Webhooks and Brain Pro Chat History Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a multi-destination outgoing Webhook platform in `ipro-kun`, then receive, normalize, search, and filter those activity events as project-scoped chat history in `brain-pro`.

**Architecture:** `ipro-db` persists versioned event snapshots and fans them out through its existing durable-job engine, with one independently retryable delivery per matching endpoint. Brain Pro exposes token-addressed, HMAC-verified receivers and stores the imported data in `chat_rooms`/`chat_messages`-equivalent raw tables plus a `documents`-equivalent unified search table. Both sides use stable event/entity keys for at-least-once idempotency.

**Tech Stack:** Next.js 16 + React 19 + Drizzle/Neon + Vitest (`ipro-kun`); NestJS + Prisma/PostgreSQL + Jest and Next.js 14 + React 18 + Vitest (`brain-pro`); HMAC-SHA256; PostgreSQL `pg_trgm`.

---

## Execution rules

- Read [the approved design](./2026-07-16-ipro-db-webhooks-chat-history-design.md) before starting.
- Use @test-driven-development for every behavior change: red test, smallest implementation, green test.
- Use @systematic-debugging for any unexpected failure; do not patch around symptoms.
- Use @frontend-design when implementing the two new user-facing interfaces.
- Use @verification-before-completion before claiming either repository is complete.
- Work in dedicated worktrees for both repositories. Do not mix this work with the existing `feat/admin-issued-member-token` branch.
- Keep `ipro-db` free of value imports from `@ipro/agent`; `scripts/check-boundaries.mjs` and `scripts/check-db-ownership.mjs` must stay green.
- Commit in the repository named by each task. Never combine files from the two repositories in one commit.

## Canonical event contract

Create `ipro-db/lib/outgoing-webhook-contract.ts` as the single source for outgoing event names and envelope types:

```ts
export const WEBHOOK_EVENT_TYPES = [
  "chat.message.created",
  "document.created",
  "document.updated",
  "recording.created",
  "recording.ready",
  "project.context.created",
  "project.memory.created",
  "tracker.task.created",
  "tracker.task.updated",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export interface OutgoingWebhookEnvelope<T = Record<string, unknown>> {
  specVersion: "1.0";
  eventId: string;
  eventType: WebhookEventType;
  companyId: string;
  projectIds: number[];
  occurredAt: string;
  data: T;
}
```

Do not duplicate this list in forms, routes, or jobs. UI view models may receive this list as primitives.

### Task 1: Create the ipro-db Webhook schema and migration

**Repository:** `/Users/kazuyukijimbo/ipro-kun`

**Files:**
- Modify: `src/shared/db/activity-schema.ts`
- Create: `migrations/0044_outgoing_webhooks.sql`
- Modify: `docs/db-ownership.md`
- Modify: `ipro-db/db/table-ownership.test.ts`

**Step 1: Write the failing ownership/schema test**

Extend `ipro-db/db/table-ownership.test.ts` to require these activity-owned tables:

```ts
expect(activityTableNames).toEqual(expect.arrayContaining([
  "webhook_endpoints",
  "webhook_endpoint_events",
  "webhook_endpoint_projects",
  "webhook_events",
  "webhook_deliveries",
]));
```

**Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/kazuyukijimbo/ipro-kun
npx vitest run ipro-db/db/table-ownership.test.ts
```

Expected: FAIL because the five tables are absent.

**Step 3: Add Drizzle definitions**

Add the five models from design §5. Use:

- serial internal IDs;
- `eventId` as text with unique index;
- normalized child tables for event and project filters;
- delivery status text with a check constraint in SQL;
- `(eventId, endpointId)` unique;
- due-delivery index on `(status, nextAttemptAt)`;
- company endpoint index and event type/time index;
- `onDelete: cascade` SQL foreign keys in the migration.

Use `jsonb` only for `projectIds`, event `payload`, and bounded delivery metadata. Store encrypted authentication material in `secretEnc` and never add a plaintext field.

**Step 4: Add migration and ownership documentation**

Write `0044_outgoing_webhooks.sql` to create the exact constraints/indexes represented in Drizzle. Add all five tables to `docs/db-ownership.md` as owner `ipro-db` and implementation module `ipro-db/db/outgoing-webhooks.ts`.

**Step 5: Run schema verification**

Run:

```bash
npx vitest run ipro-db/db/table-ownership.test.ts
npm run check:ownership
npm run check:boundaries
npx tsc --noEmit
```

Expected: all PASS.

**Step 6: Commit**

```bash
git add src/shared/db/activity-schema.ts migrations/0044_outgoing_webhooks.sql docs/db-ownership.md ipro-db/db/table-ownership.test.ts
git commit -m "feat(ipro-db): add outgoing webhook persistence"
```

### Task 2: Add the Webhook contract and endpoint repository

**Repository:** `/Users/kazuyukijimbo/ipro-kun`

**Files:**
- Create: `ipro-db/lib/outgoing-webhook-contract.ts`
- Create: `ipro-db/db/outgoing-webhooks.ts`
- Create: `ipro-db/db/outgoing-webhooks.test.ts`
- Modify: `ipro-db/api/index.ts`

**Step 1: Write failing repository tests**

Cover:

```ts
it("creates two endpoints for one company and keeps their filters independent", async () => {});
it("never returns secretEnc in endpoint views", async () => {});
it("matches all-project endpoint plus intersecting project endpoint", async () => {});
it("does not match another company or an inactive endpoint", async () => {});
it("creates only one delivery per event and endpoint", async () => {});
```

Use the existing test DB/mocking style from `ipro-db/db/documents.test.ts` and `chat-messages.test.ts`.

**Step 2: Run tests to verify red**

```bash
npx vitest run ipro-db/db/outgoing-webhooks.test.ts
```

Expected: FAIL with missing module/exports.

**Step 3: Implement endpoint and event functions**

Implement explicit functions rather than exposing raw tables:

```ts
listWebhookEndpoints(companyId)
getWebhookEndpoint(companyId, endpointId)
createWebhookEndpoint(input)
updateWebhookEndpoint(companyId, endpointId, patch)
deleteWebhookEndpoint(companyId, endpointId)
replaceWebhookEndpointFilters(companyId, endpointId, eventTypes, projectIds)
publishWebhookEvent(input)
listMatchingWebhookEndpoints(companyId, eventType, projectIds)
ensureWebhookDeliveries(eventId)
listWebhookDeliveries(companyId, filters)
retryWebhookDelivery(companyId, deliveryId)
```

`publishWebhookEvent` must accept a deterministic optional `dedupKey`; convert it to a stable public event ID so retried producers/backfills do not create duplicate events.

Export only the functions needed by `ipro-agent` from `ipro-db/api/index.ts`. Do not export Drizzle tables or decrypted secrets.

**Step 4: Run tests and boundary checks**

```bash
npx vitest run ipro-db/db/outgoing-webhooks.test.ts
npm run check:ownership
npm run check:boundaries
npx tsc --noEmit
```

Expected: all PASS.

**Step 5: Commit**

```bash
git add ipro-db/lib/outgoing-webhook-contract.ts ipro-db/db/outgoing-webhooks.ts ipro-db/db/outgoing-webhooks.test.ts ipro-db/api/index.ts
git commit -m "feat(ipro-db): manage webhook endpoints and events"
```

### Task 3: Add outbound URL safety, signing, and request construction

**Repository:** `/Users/kazuyukijimbo/ipro-kun`

**Files:**
- Create: `ipro-db/lib/webhook-url-safety.ts`
- Create: `ipro-db/lib/webhook-url-safety.test.ts`
- Create: `ipro-db/lib/webhook-request.ts`
- Create: `ipro-db/lib/webhook-request.test.ts`

**Step 1: Write URL-safety tests**

Test production rejection of:

- `http:` URLs;
- loopback and `localhost`;
- RFC1918, link-local, IPv6 local addresses;
- `169.254.169.254` and equivalent metadata names;
- hostnames resolving to blocked IPs;
- redirects.

Allow HTTPS public addresses and allow explicit localhost only when `NODE_ENV !== "production"`.

**Step 2: Write signing/request tests**

Assert exact signature generation:

```ts
const timestamp = "1784196000";
const raw = JSON.stringify(envelope);
expect(signWebhook(secret, timestamp, raw)).toBe(
  createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex"),
);
```

Also test HMAC, Bearer, and none header sets; timeout; response snippet cap; and no redirect following.

**Step 3: Run tests to verify red**

```bash
npx vitest run ipro-db/lib/webhook-url-safety.test.ts ipro-db/lib/webhook-request.test.ts
```

Expected: FAIL because modules are missing.

**Step 4: Implement the safety and request helpers**

Resolve DNS immediately before sending, validate every returned IP, set `redirect: "manual"`, cap response text, and use `AbortSignal.timeout(endpoint.timeoutMs)`. Build raw JSON once and sign those exact bytes.

Never log or return decrypted authentication material. Return a normalized result:

```ts
type DeliveryAttemptResult =
  | { kind: "success"; status: number; responseSnippet: string }
  | { kind: "retry"; status?: number; error: string; responseSnippet?: string }
  | { kind: "dead"; status: number; error: string; responseSnippet: string };
```

**Step 5: Run tests**

```bash
npx vitest run ipro-db/lib/webhook-url-safety.test.ts ipro-db/lib/webhook-request.test.ts
npx tsc --noEmit
```

Expected: PASS.

**Step 6: Commit**

```bash
git add ipro-db/lib/webhook-url-safety.ts ipro-db/lib/webhook-url-safety.test.ts ipro-db/lib/webhook-request.ts ipro-db/lib/webhook-request.test.ts
git commit -m "feat(ipro-db): secure outgoing webhook requests"
```

### Task 4: Add durable delivery and retry pipelines

**Repository:** `/Users/kazuyukijimbo/ipro-kun`

**Files:**
- Create: `ipro-db/jobs/pipelines/webhook-delivery.ts`
- Create: `ipro-db/jobs/pipelines/webhook-delivery.test.ts`
- Modify: `ipro-db/jobs/pipelines/index.ts`
- Modify: `ipro-db/db/outgoing-webhooks.ts`
- Modify: `ipro-db/db/jobs.ts`

**Step 1: Write failing pipeline tests**

Cover 2xx success, 408/429/5xx retry, network retry, ordinary 4xx dead, maximum eight attempts, and independent endpoint outcomes for the same event.

**Step 2: Run the focused test**

```bash
npx vitest run ipro-db/jobs/pipelines/webhook-delivery.test.ts
```

Expected: FAIL because pipeline is not registered.

**Step 3: Implement enqueue and delivery state transitions**

Use job type `webhook_delivery`, entity type `webhook_delivery`, and entity ref equal to the delivery ID. The job step loads the event and endpoint fresh, decrypts only in memory, calls `sendWebhookRequest`, and updates the delivery record.

Use deterministic in-flight `dedupKey: webhook_delivery:<deliveryId>`. Keep the delivery table as the user-visible source of truth; job rows remain the execution mechanism.

For retry results, return the existing durable-job `retry(error)` and update delivery status to `retrying`. For dead results, record the terminal delivery then return `done()` so an ordinary destination 4xx does not look like an infrastructure job crash.

**Step 4: Register the pipeline and run tests**

```bash
npx vitest run ipro-db/jobs/pipelines/webhook-delivery.test.ts ipro-db/jobs/runner.test.ts
npm run check:boundaries
npx tsc --noEmit
```

Expected: all PASS.

**Step 5: Commit**

```bash
git add ipro-db/jobs/pipelines/webhook-delivery.ts ipro-db/jobs/pipelines/webhook-delivery.test.ts ipro-db/jobs/pipelines/index.ts ipro-db/db/outgoing-webhooks.ts ipro-db/db/jobs.ts
git commit -m "feat(ipro-db): deliver webhooks with durable retries"
```

### Task 5: Publish chat and document events

**Repository:** `/Users/kazuyukijimbo/ipro-kun`

**Files:**
- Modify: `ipro-db/db/chat-messages.ts`
- Modify: `ipro-db/db/chat-messages.test.ts`
- Modify: `ipro-db/db/documents.ts`
- Modify: `ipro-db/db/documents.test.ts`
- Modify: `ipro-db/db/projects.ts`
- Create: `ipro-db/db/webhook-project-resolution.test.ts`

**Step 1: Write failing producer tests**

Assert:

- a new chat row emits exactly one `chat.message.created`;
- webhook retry of the same platform/room/message does not duplicate the event;
- a new document emits `document.created` and an existing URL update emits `document.updated`;
- channel membership resolves every related project, not just the first;
- an unassigned activity keeps `projectIds: []` for company-wide endpoints.

**Step 2: Run tests to verify red**

```bash
npx vitest run ipro-db/db/chat-messages.test.ts ipro-db/db/documents.test.ts ipro-db/db/webhook-project-resolution.test.ts
```

Expected: FAIL on missing publisher calls.

**Step 3: Implement project resolution and event publication**

Add narrow query helpers to `projects.ts`:

```ts
projectIdsForChannel(companyId, channelId)
projectIdsForRecording(companyId, recordingId)
```

Publish from the canonical DB entry points, not each Slack/LINE/Teams surface. Include room name when it can be resolved without an external API; otherwise send stable room ID and let later room events enrich it.

Use deterministic keys:

```text
chat.message.created:<platform>:<roomId>:<messageId>
document.created:<documentId>:<contentHash>
document.updated:<documentId>:<contentHash>
```

Ensure a producer retry calls `ensureWebhookDeliveries` even if the source row already exists, repairing a prior enqueue interruption.

**Step 4: Run tests**

```bash
npx vitest run ipro-db/db/chat-messages.test.ts ipro-db/db/documents.test.ts ipro-db/db/webhook-project-resolution.test.ts
npm run check:boundaries
npx tsc --noEmit
```

Expected: PASS.

**Step 5: Commit**

```bash
git add ipro-db/db/chat-messages.ts ipro-db/db/chat-messages.test.ts ipro-db/db/documents.ts ipro-db/db/documents.test.ts ipro-db/db/projects.ts ipro-db/db/webhook-project-resolution.test.ts
git commit -m "feat(ipro-db): publish chat and document webhooks"
```

### Task 6: Publish recording, context, memory, and tracker events

**Repository:** `/Users/kazuyukijimbo/ipro-kun`

**Files:**
- Modify: `ipro-db/db/recordings.ts`
- Create: `ipro-db/db/recordings-webhook.test.ts`
- Modify: `ipro-db/db/project-context.ts`
- Create: `ipro-db/db/project-context-webhook.test.ts`
- Modify: `ipro-db/db/project-memory.ts`
- Create: `ipro-db/db/project-memory.test.ts`
- Modify: `ipro-db/db/tracker-tasks.ts`
- Modify: `ipro-db/db/project-tracker-links.ts`
- Create: `ipro-db/db/tracker-tasks-webhook.test.ts`

**Step 1: Write failing tests for meaningful transitions**

Test that:

- only a newly inserted recording emits `recording.created`;
- `recording.ready` emits only when media or transcript crosses into ready/done, not on unrelated patches;
- context/memory insert includes its single project ID;
- tracker upsert distinguishes create/update and resolves all linked ipro projects;
- an unchanged tracker payload does not create noisy update events.

**Step 2: Run focused tests**

```bash
npx vitest run ipro-db/db/recordings-webhook.test.ts ipro-db/db/project-context-webhook.test.ts ipro-db/db/project-memory.test.ts ipro-db/db/tracker-tasks-webhook.test.ts
```

Expected: FAIL.

**Step 3: Add minimal publication logic**

Return inserted/upserted rows where needed so the event snapshot comes from the saved values. Compare prior tracker/recording state before selecting created versus updated/ready. Do not emit from polling loops separately.

**Step 4: Run producer and integration tests**

```bash
npx vitest run ipro-db/db/recordings-webhook.test.ts ipro-db/db/project-context-webhook.test.ts ipro-db/db/project-memory.test.ts ipro-db/db/tracker-tasks-webhook.test.ts
npm run check:ownership
npm run check:boundaries
npx tsc --noEmit
```

Expected: PASS.

**Step 5: Commit**

```bash
git add ipro-db/db/recordings.ts ipro-db/db/recordings-webhook.test.ts ipro-db/db/project-context.ts ipro-db/db/project-context-webhook.test.ts ipro-db/db/project-memory.ts ipro-db/db/project-memory.test.ts ipro-db/db/tracker-tasks.ts ipro-db/db/project-tracker-links.ts ipro-db/db/tracker-tasks-webhook.test.ts
git commit -m "feat(ipro-db): publish activity webhooks"
```

### Task 7: Add idempotent historical backfill

**Repository:** `/Users/kazuyukijimbo/ipro-kun`

**Files:**
- Create: `ipro-db/jobs/pipelines/webhook-backfill.ts`
- Create: `ipro-db/jobs/pipelines/webhook-backfill.test.ts`
- Modify: `ipro-db/jobs/pipelines/index.ts`
- Modify: `ipro-db/db/outgoing-webhooks.ts`
- Create: `ipro-db/db/webhook-backfill.ts`
- Create: `ipro-db/db/webhook-backfill.test.ts`

**Step 1: Write failing backfill tests**

Cover preview counts by endpoint/events/projects/date range, cursor chunking, resume after failure, deterministic event IDs, and no duplicates when the same backfill is run twice.

**Step 2: Run tests to verify red**

```bash
npx vitest run ipro-db/db/webhook-backfill.test.ts ipro-db/jobs/pipelines/webhook-backfill.test.ts
```

Expected: FAIL.

**Step 3: Implement preview and chunk readers**

Provide one normalized iterator per source table. Keep a cursor `{ source, lastId }` in job payload, cap each step to 100 source rows, and return `wait(0)`/`next()` so execution remains within serverless limits.

Backfill event IDs must derive from source type, stable source identity, and relevant content version. Backfill must target the selected endpoint only rather than redistributing old data to every matching endpoint.

**Step 4: Register and test**

```bash
npx vitest run ipro-db/db/webhook-backfill.test.ts ipro-db/jobs/pipelines/webhook-backfill.test.ts ipro-db/jobs/runner.test.ts
npx tsc --noEmit
```

Expected: PASS.

**Step 5: Commit**

```bash
git add ipro-db/jobs/pipelines/webhook-backfill.ts ipro-db/jobs/pipelines/webhook-backfill.test.ts ipro-db/jobs/pipelines/index.ts ipro-db/db/outgoing-webhooks.ts ipro-db/db/webhook-backfill.ts ipro-db/db/webhook-backfill.test.ts
git commit -m "feat(ipro-db): backfill outgoing webhook history"
```

### Task 8: Build the ipro-db Webhook management API and console UI

**Repository:** `/Users/kazuyukijimbo/ipro-kun`

**Files:**
- Create: `app/console/webhooks/page.tsx`
- Create: `app/console/webhooks/action/route.ts`
- Create: `app/console/webhooks/action/route.test.ts`
- Create: `src/wiring/loaders/webhooks.ts`
- Create: `ipro-ui/console/webhooks/types.ts`
- Create: `ipro-ui/console/webhooks/View.tsx`
- Create: `ipro-ui/console/webhooks/WebhookManager.tsx`
- Create: `ipro-ui/console/webhooks/View.test.tsx`
- Modify: `ipro-ui/console/Sidebar.tsx`

**Step 1: Write route authorization tests**

Test unauthenticated 401, ordinary member 403, cross-company 403, admin create/update/pause/delete/test/retry/backfill success, invalid event type 400, and unsafe URL 400.

**Step 2: Write UI tests**

Test two endpoints rendering independently, event/project multi-select, masked secret state, one-time generated secret display, status filters, retry button, and backfill preview confirmation.

**Step 3: Run tests to verify red**

```bash
npx vitest run app/console/webhooks/action/route.test.ts ipro-ui/console/webhooks/View.test.tsx
```

Expected: FAIL because routes/components do not exist.

**Step 4: Implement the server shell and actions**

Follow `app/console/service-accounts/page.tsx` and its action route:

- resolve `companyId` with `resolveAdminCompany`/`canAdminCompany`;
- return primitive view models only;
- never send `secretEnc` to the UI;
- require credential re-entry when URL changes;
- return generated HMAC secret only in the create/rotate response;
- expose test send and backfill preview/start as explicit actions.

**Step 5: Implement the UI**

Use @frontend-design. Add “Webhook” under the “運用” sidebar group. Provide endpoint cards/table, edit dialog, active toggle, delivery status tabs, test button, retry action, and a backfill dialog. Keep forms keyboard accessible and pair every icon-only button with an accessible name.

**Step 6: Run UI, type, and boundary tests**

```bash
npx vitest run app/console/webhooks/action/route.test.ts ipro-ui/console/webhooks/View.test.tsx
npm run check:ownership
npm run check:boundaries
npx tsc --noEmit
```

Expected: PASS.

**Step 7: Commit**

```bash
git add app/console/webhooks src/wiring/loaders/webhooks.ts ipro-ui/console/webhooks ipro-ui/console/Sidebar.tsx
git commit -m "feat(console): manage outgoing webhooks"
```

### Task 9: Document and verify the ipro-kun sender

**Repository:** `/Users/kazuyukijimbo/ipro-kun`

**Files:**
- Create: `docs/outgoing-webhooks.md`
- Modify: `README.md`

**Step 1: Write the sender documentation**

Include:

- UI setup for multiple destinations;
- event catalog and complete payload examples;
- HMAC verification examples in TypeScript and shell/OpenSSL;
- HMAC/Bearer/none behavior;
- retry matrix and manual retry;
- backfill and idempotency;
- SSRF restrictions;
- secret rotation;
- steps and tests required to add a new event producer;
- troubleshooting for 401, 404, 429, 5xx, timeout, and dead delivery.

**Step 2: Link it from README**

Add one focused link under integration/operations documentation.

**Step 3: Run the complete sender verification**

```bash
cd /Users/kazuyukijimbo/ipro-kun
npm test
npx tsc --noEmit
npm run build
git diff --check
```

Expected: all commands exit 0.

**Step 4: Commit**

```bash
git add docs/outgoing-webhooks.md README.md
git commit -m "docs(ipro-db): document outgoing webhooks"
```

### Task 10: Add Brain Pro inbound and activity schema

**Repository:** `/Users/kazuyukijimbo/brain-pro`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260718000000_ipro_activity_webhooks/migration.sql`
- Create: `backend/src/infrastructure/services/ipro-webhook-signature.ts`
- Create: `backend/src/infrastructure/services/ipro-webhook-signature.spec.ts`

**Step 1: Write the failing signature tests**

Test correct signature, wrong signature, stale/future timestamp, malformed header, and constant-time-safe comparison behavior.

**Step 2: Run the signature test to verify red**

```bash
cd /Users/kazuyukijimbo/brain-pro/backend
npm test -- --runInBand ipro-webhook-signature.spec.ts
```

Expected: FAIL with missing module.

**Step 3: Add Prisma models**

Add relations from `Project` for:

- `IproWebhookSource`;
- `IproWebhookReceipt`（`(projectId,eventId)` 一意。同じイベントの別 Brain Pro プロジェクトへの取り込みは許可）;
- `IproActivityRoom`;
- `IproActivityMessage`;
- `IproActivityDocument`.

Use the exact responsibilities and unique keys in design §7. Store token hash, not token; encrypt HMAC secret with `CryptoService`. Keep raw event payload only in receipt metadata if bounded and needed for diagnosis; do not duplicate unrestricted payloads in every table.

**Step 4: Add SQL migration and search indexes**

The migration must:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX ... USING gin (content gin_trgm_ops);
CREATE INDEX ... USING gin (coalesce(title, '') gin_trgm_ops);
CREATE INDEX ... USING gin (coalesce(author_name, '') gin_trgm_ops);
CREATE INDEX ... USING gin (coalesce(room_name, '') gin_trgm_ops);
```

Also add B-tree indexes for `(project_id, occurred_at desc)`, source, platform, room, author, and message context order.

**Step 5: Implement and run validation**

```bash
npm test -- --runInBand ipro-webhook-signature.spec.ts
npx prisma validate --schema=prisma/schema.prisma
npx prisma generate --schema=prisma/schema.prisma
npm run build
```

Expected: all PASS.

**Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260718000000_ipro_activity_webhooks/migration.sql backend/src/infrastructure/services/ipro-webhook-signature.ts backend/src/infrastructure/services/ipro-webhook-signature.spec.ts
git commit -m "feat(backend): add ipro activity webhook schema"
```

### Task 11: Add Brain Pro Webhook source management

**Repository:** `/Users/kazuyukijimbo/brain-pro`

**Files:**
- Create: `backend/src/presentation/controllers/ipro-webhook-source.controller.ts`
- Create: `backend/src/presentation/controllers/ipro-webhook-source.controller.spec.ts`
- Modify: `backend/src/presentation/controllers/index.ts`
- Modify: `backend/src/app.module.ts`

**Step 1: Write failing controller tests**

Test:

- project viewer/member without admin rights is rejected;
- project/organization admin can list/create/pause/delete/rotate;
- source token and secret are returned only on create/rotate;
- list response exposes neither token hash nor encrypted secret;
- a scoped token cannot manage another project/company.

**Step 2: Run the test to verify red**

```bash
cd /Users/kazuyukijimbo/brain-pro/backend
npm test -- --runInBand ipro-webhook-source.controller.spec.ts
```

Expected: FAIL.

**Step 3: Implement source management endpoints**

Use project-scoped routes:

```text
GET    /api/projects/:projectId/ipro-webhook-sources
POST   /api/projects/:projectId/ipro-webhook-sources
PATCH  /api/projects/:projectId/ipro-webhook-sources/:sourceId
DELETE /api/projects/:projectId/ipro-webhook-sources/:sourceId
POST   /api/projects/:projectId/ipro-webhook-sources/:sourceId/rotate
```

Generate `sourceToken` and HMAC secret with `node:crypto`. Persist SHA-256 token hash and encrypted secret. Return receiver URL based on configured backend public URL, plus the plaintext secret exactly once.

Reuse the existing project access guard for project scope and add explicit organization OWNER/ADMIN or super-admin enforcement for secret management.

**Step 4: Register controller and run tests**

```bash
npm test -- --runInBand ipro-webhook-source.controller.spec.ts
npm run build
```

Expected: PASS.

**Step 5: Commit**

```bash
git add backend/src/presentation/controllers/ipro-webhook-source.controller.ts backend/src/presentation/controllers/ipro-webhook-source.controller.spec.ts backend/src/presentation/controllers/index.ts backend/src/app.module.ts
git commit -m "feat(backend): manage ipro webhook sources"
```

### Task 12: Receive and normalize ipro-db events

**Repository:** `/Users/kazuyukijimbo/brain-pro`

**Files:**
- Create: `backend/src/infrastructure/services/ipro-activity-ingest.service.ts`
- Create: `backend/src/infrastructure/services/ipro-activity-ingest.service.spec.ts`
- Create: `backend/src/presentation/controllers/ipro-activity-webhook.controller.ts`
- Create: `backend/src/presentation/controllers/ipro-activity-webhook.controller.spec.ts`
- Modify: `backend/src/presentation/controllers/index.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/presentation/interceptors/change-log.interceptor.ts`

**Step 1: Write failing receiver tests**

Cover unknown/inactive token, invalid/stale signature, event/header mismatch, malformed envelope, oversized body, accepted event, duplicate event, and receipt error recording.

Use the raw body captured by `backend/src/app-setup.ts`; never re-stringify parsed JSON for verification.

**Step 2: Write failing normalization tests**

Assert:

- `chat.message.created` upserts room, message, and search document;
- duplicate external message stays one row;
- one incoming event can be sent to two different Brain Pro project sources and creates one row per project;
- document/recording/context/memory/tracker events upsert search documents with stable `sourceRef`;
- receipt is processed only after normalization succeeds.

**Step 3: Run tests to verify red**

```bash
cd /Users/kazuyukijimbo/brain-pro/backend
npm test -- --runInBand ipro-activity-webhook.controller.spec.ts ipro-activity-ingest.service.spec.ts
```

Expected: FAIL.

**Step 4: Implement the public receiver**

Use `@Public()` on `POST /api/webhooks/ipro-db/:sourceToken`. Token plus HMAC is the authentication; do not accept ordinary JWT as a substitute. Validate envelope `specVersion === "1.0"`, allowed event type, exact event/header IDs, and timestamp.

Insert receipt and normalized records in one Prisma transaction. On `(projectId,eventId)` unique receipt conflict, return `{ ok: true, duplicate: true }`. Cap stored error text and update source `lastReceivedAt`/`lastError` without leaking secrets.

Exclude the public receiver route from `ChangeLogInterceptor`; the receipt table is its audit trail.

**Step 5: Run tests and build**

```bash
npm test -- --runInBand ipro-activity-webhook.controller.spec.ts ipro-activity-ingest.service.spec.ts
npm run build
```

Expected: PASS.

**Step 6: Commit**

```bash
git add backend/src/infrastructure/services/ipro-activity-ingest.service.ts backend/src/infrastructure/services/ipro-activity-ingest.service.spec.ts backend/src/presentation/controllers/ipro-activity-webhook.controller.ts backend/src/presentation/controllers/ipro-activity-webhook.controller.spec.ts backend/src/presentation/controllers/index.ts backend/src/app.module.ts backend/src/presentation/interceptors/change-log.interceptor.ts
git commit -m "feat(backend): ingest ipro activity webhooks"
```

### Task 13: Add server-side chat search, facets, and context APIs

**Repository:** `/Users/kazuyukijimbo/brain-pro`

**Files:**
- Create: `backend/src/infrastructure/services/ipro-chat-history.service.ts`
- Create: `backend/src/infrastructure/services/ipro-chat-history.service.spec.ts`
- Create: `backend/src/presentation/controllers/ipro-chat-history.controller.ts`
- Create: `backend/src/presentation/controllers/ipro-chat-history.controller.spec.ts`
- Create: `backend/src/presentation/dto/ipro-chat-history/query-chat-history.dto.ts`
- Create: `backend/src/presentation/dto/ipro-chat-history/index.ts`
- Modify: `backend/src/presentation/dto/index.ts`
- Modify: `backend/src/presentation/controllers/index.ts`
- Modify: `backend/src/app.module.ts`

**Step 1: Write failing service tests**

Seed or mock documents/messages to test Japanese partial match, escaped wildcard characters, multi-source/platform/room/author filters, date boundaries, `hasMedia`, stable cursor ordering, facets under the current non-facet filters, and ±10 message context.

**Step 2: Write failing controller authorization tests**

Test project VIEW access succeeds and another project is rejected for all three endpoints.

**Step 3: Run tests to verify red**

```bash
cd /Users/kazuyukijimbo/brain-pro/backend
npm test -- --runInBand ipro-chat-history.service.spec.ts ipro-chat-history.controller.spec.ts
```

Expected: FAIL.

**Step 4: Implement query DTO and service**

Validate and cap `limit` at 100. Parse repeated query parameters into arrays. Encode cursor from `(occurredAt,id)` rather than offset. Use parameterized Prisma raw queries for `ILIKE`/trigram-compatible search; never interpolate user text.

Return:

```ts
interface ChatHistoryPage {
  items: ChatHistoryItem[];
  nextCursor: string | null;
}
```

Facet values include key, label, and count. Context returns selected message plus ordered before/after arrays.

**Step 5: Register routes and run tests**

```bash
npm test -- --runInBand ipro-chat-history.service.spec.ts ipro-chat-history.controller.spec.ts
npm run build
```

Expected: PASS.

**Step 6: Commit**

```bash
git add backend/src/infrastructure/services/ipro-chat-history.service.ts backend/src/infrastructure/services/ipro-chat-history.service.spec.ts backend/src/presentation/controllers/ipro-chat-history.controller.ts backend/src/presentation/controllers/ipro-chat-history.controller.spec.ts backend/src/presentation/dto/ipro-chat-history backend/src/presentation/dto/index.ts backend/src/presentation/controllers/index.ts backend/src/app.module.ts
git commit -m "feat(backend): search ipro chat history"
```

### Task 14: Add the frontend chat-history API and URL-state helpers

**Repository:** `/Users/kazuyukijimbo/brain-pro`

**Files:**
- Create: `frontend/src/lib/ipro-chat-history.ts`
- Create: `frontend/src/lib/ipro-chat-history.test.ts`
- Create: `frontend/src/lib/chat-history-query.ts`
- Create: `frontend/src/lib/chat-history-query.test.ts`

**Step 1: Write failing helper tests**

Cover parse/serialize round trips for:

```ts
{
  q, sources, platforms, roomIds, authors,
  from, to, hasMedia, sort
}
```

Assert arrays are stable-sorted/deduplicated, empty defaults are omitted, invalid dates are dropped, and clearing one filter preserves all others.

**Step 2: Run tests to verify red**

```bash
cd /Users/kazuyukijimbo/brain-pro/frontend
npm test -- ipro-chat-history.test.ts chat-history-query.test.ts
```

Expected: FAIL.

**Step 3: Implement typed API calls and URL helpers**

Use the existing `api()` wrapper and `URLSearchParams`. Define shared frontend types for item, page, facets, and context. Do not fetch all rows and filter in React.

**Step 4: Run tests**

```bash
npm test -- ipro-chat-history.test.ts chat-history-query.test.ts
npx tsc --noEmit
```

Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/lib/ipro-chat-history.ts frontend/src/lib/ipro-chat-history.test.ts frontend/src/lib/chat-history-query.ts frontend/src/lib/chat-history-query.test.ts
git commit -m "feat(frontend): add chat history query client"
```

### Task 15: Build the Brain Pro chat-history search interface

**Repository:** `/Users/kazuyukijimbo/brain-pro`

**Files:**
- Create: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/chat-history/page.tsx`
- Create: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/chat-history/_components/ChatHistoryFilters.tsx`
- Create: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/chat-history/_components/ChatHistoryResults.tsx`
- Create: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/chat-history/_components/MessageContextPane.tsx`
- Create: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/chat-history/_components/chat-history-view.test.tsx`
- Modify: `frontend/src/app/(dashboard)/layout.tsx`

**Step 1: Write failing interaction tests**

Test:

- initial URL filters drive the first request;
- text search is debounced or submitted without request storms;
- Today/7 days/30 days shortcuts;
- multi-select facets with counts;
- removable active-filter chips;
- cursor load-more appends without duplicates;
- selecting an item loads context;
- `/` focuses search and Escape clears/backs out predictably;
- loading, empty, error, and retry states;
- match highlighting escapes regex metacharacters and never uses unsafe HTML.

**Step 2: Run tests to verify red**

```bash
cd /Users/kazuyukijimbo/brain-pro/frontend
npm test -- chat-history-view.test.tsx
```

Expected: FAIL.

**Step 3: Implement the page shell and filters**

Use @frontend-design. Add “チャット履歴” with a message/search icon under the “背景・目的” group. Build a sticky search/filter header, accessible multi-select controls, period shortcuts, active chips, result count, and URL state synchronization via router replacement.

**Step 4: Implement results and context pane**

Render platform/source, room, author, timestamp, safe highlighted snippet, and attachment indicator. On wide screens use a result list plus right context pane; on narrow screens show context in a drawer/stacked detail. Preserve result scroll position when closing detail.

**Step 5: Run frontend verification**

```bash
npm test -- chat-history-view.test.tsx ipro-chat-history.test.ts chat-history-query.test.ts
npx tsc --noEmit
npm run build
```

Expected: PASS.

**Step 6: Commit**

```bash
git add 'frontend/src/app/(dashboard)/dashboard/projects/[projectId]/chat-history' 'frontend/src/app/(dashboard)/layout.tsx'
git commit -m "feat(frontend): add searchable chat history"
```

### Task 16: Build Brain Pro inbound Webhook settings UI

**Repository:** `/Users/kazuyukijimbo/brain-pro`

**Files:**
- Create: `frontend/src/lib/ipro-webhook-sources.ts`
- Create: `frontend/src/lib/ipro-webhook-sources.test.ts`
- Create: `frontend/src/components/project/IproWebhookSourcesPanel.tsx`
- Create: `frontend/src/components/project/IproWebhookSourcesPanel.test.tsx`
- Modify: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/settings/page.tsx`
- Modify: `frontend/src/app/(dashboard)/layout.tsx`

**Step 1: Write failing API/UI tests**

Test list/create/pause/delete/rotate, one-time secret display, copy controls, confirmation before rotate/delete, masked normal state, last received/error display, and read-only disabling.

**Step 2: Run tests to verify red**

```bash
cd /Users/kazuyukijimbo/brain-pro/frontend
npm test -- ipro-webhook-sources.test.ts IproWebhookSourcesPanel.test.tsx
```

Expected: FAIL.

**Step 3: Implement client and panel**

Add a third settings tab `webhooks` labeled “ipro-db受信”. Update sidebar settings children to `general`, `roles`, `webhooks`. Display the generated URL and secret in a non-dismissible warning panel until the user acknowledges copying them; never put either value in logs.

**Step 4: Run tests and build**

```bash
npm test -- ipro-webhook-sources.test.ts IproWebhookSourcesPanel.test.tsx
npx tsc --noEmit
npm run build
```

Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/lib/ipro-webhook-sources.ts frontend/src/lib/ipro-webhook-sources.test.ts frontend/src/components/project/IproWebhookSourcesPanel.tsx frontend/src/components/project/IproWebhookSourcesPanel.test.tsx 'frontend/src/app/(dashboard)/dashboard/projects/[projectId]/settings/page.tsx' 'frontend/src/app/(dashboard)/layout.tsx'
git commit -m "feat(frontend): manage ipro webhook receivers"
```

### Task 17: Document and expose the Brain Pro integration

**Repository:** `/Users/kazuyukijimbo/brain-pro`

**Files:**
- Create: `docs/ipro-db-chat-history.md`
- Modify: `docs/README.md`
- Modify: `docs/04-api-spec.md`
- Modify: `backend/src/presentation/controllers/ipro-activity-webhook.controller.ts`
- Modify: `backend/src/presentation/controllers/ipro-chat-history.controller.ts`
- Modify: `backend/src/presentation/controllers/ipro-webhook-source.controller.ts`

**Step 1: Add complete OpenAPI decorators**

Document receiver headers/body, source settings, search query arrays, cursor, facets, context, and 400/401/403/404/409 responses. Include a realistic Japanese message example.

**Step 2: Write the integration guide**

Include:

- Brain Pro receiver creation;
- entering URL/secret in ipro-db;
- multi-link and multi-project examples;
- DB mapping from `chat_rooms`, `chat_messages`, `documents`;
- signature and idempotency behavior;
- search/filter API examples;
- backfill procedure;
- secret rotation without downtime;
- troubleshooting delivery, signature, receipt, normalization, and search issues.

**Step 3: Link docs and update API spec**

Link the guide from `docs/README.md` and summarize public routes in `docs/04-api-spec.md`.

**Step 4: Run backend/frontend verification**

```bash
cd /Users/kazuyukijimbo/brain-pro/backend
npm test -- --runInBand ipro-webhook-signature.spec.ts ipro-webhook-source.controller.spec.ts ipro-activity-webhook.controller.spec.ts ipro-activity-ingest.service.spec.ts ipro-chat-history.service.spec.ts ipro-chat-history.controller.spec.ts
npm run build
cd /Users/kazuyukijimbo/brain-pro/frontend
npm test -- ipro-chat-history.test.ts chat-history-query.test.ts chat-history-view.test.tsx ipro-webhook-sources.test.ts IproWebhookSourcesPanel.test.tsx
npx tsc --noEmit
npm run build
cd /Users/kazuyukijimbo/brain-pro
git diff --check
```

Expected: all commands exit 0.

**Step 5: Commit**

```bash
git add docs/ipro-db-chat-history.md docs/README.md docs/04-api-spec.md backend/src/presentation/controllers/ipro-activity-webhook.controller.ts backend/src/presentation/controllers/ipro-chat-history.controller.ts backend/src/presentation/controllers/ipro-webhook-source.controller.ts
git commit -m "docs: document ipro-db chat history integration"
```

### Task 18: Run cross-repository integration and final verification

**Repositories:** both

**Files:**
- Create if no existing integration harness fits: `backend/scripts/verify-ipro-webhook.mjs`
- Modify only if failures expose a real defect: files from Tasks 1–17

**Step 1: Prepare local databases and services**

Apply the ipro migration to a disposable activity DB and the Brain Pro Prisma migration to a disposable Brain Pro DB. Start both applications with test secrets. Do not use production credentials.

**Step 2: Create two Brain Pro receiver sources and two ipro endpoints**

Configure:

- endpoint A: chat/document events for ipro project 12 → Brain project A;
- endpoint B: chat events for ipro projects 12 and 18 → Brain project B.

**Step 3: Send a signed test and real activity event**

Verify both destinations receive the shared event, only subscribed events arrive, and one unavailable destination retries without blocking the other.

**Step 4: Run a backfill twice**

Verify delivery rows may show repeated attempts but Brain Pro receipts/messages/documents remain unique.

**Step 5: Exercise search**

Search Japanese substrings and combine platform, room, author, date, and attachment filters. Open a result and verify before/after context ordering.

**Step 6: Run complete automated verification**

```bash
cd /Users/kazuyukijimbo/ipro-kun
npm test
npx tsc --noEmit
npm run build
git status --short

cd /Users/kazuyukijimbo/brain-pro
pnpm --filter @dataflow/backend test -- --runInBand
pnpm --filter @dataflow/backend build
pnpm --filter @dataflow/frontend test
pnpm --filter @dataflow/frontend exec tsc --noEmit
pnpm --filter @dataflow/frontend build
git status --short
```

Expected: all test/build/typecheck commands exit 0; status contains only intentional changes/commits.

**Step 7: Review the implementation against completion criteria**

Confirm every design §15 item with evidence. Use @requesting-code-review, resolve only verified findings with @receiving-code-review, then use @verification-before-completion.

**Step 8: Commit any integration-only harness**

```bash
git add backend/scripts/verify-ipro-webhook.mjs
git commit -m "test: add ipro webhook integration smoke test"
```

Skip this commit if no harness file was needed.
