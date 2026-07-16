# Knowledge Received History Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a standalone Knowledge sidebar category with searchable chat and resource receipt history pages backed by the existing project-scoped activity API.

**Architecture:** Keep the NestJS API and Prisma schema unchanged. Add a typed frontend activity-history client, a shared responsive timeline/inspector component configured by `chat` or `resource`, two thin Next.js page entries, and a small testable navigation builder consumed by the existing dashboard layout.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, Lucide React, Vitest, Testing Library.

---

## Execution rules

- Read [the approved design](./2026-07-17-knowledge-received-history-design.md).
- Use @test-driven-development for each behavior: failing test, verify red, minimal implementation, verify green.
- Use @frontend-design for the timeline, filter bar, detail inspector, loading, empty, and error states.
- Use @systematic-debugging for unexpected failures.
- Use @verification-before-completion before merge or completion claims.
- Commit each completed task separately.

### Task 1: Add the typed activity-history client

**Files:**
- Create: `frontend/src/lib/ipro-activity.test.ts`
- Create: `frontend/src/lib/ipro-activity.ts`

**Step 1: Write the failing tests**

Cover:

```ts
it('builds chat search with source=chat and active filters', () => {});
it('builds resource search with all supported resource sources', () => {});
it('requests cursor pages and message context with auth headers', async () => {});
it('maps source and platform values to stable Japanese labels', () => {});
```

**Step 2: Verify RED**

Run:

```bash
cd frontend
./node_modules/.bin/vitest run src/lib/ipro-activity.test.ts
```

Expected: FAIL because `ipro-activity.ts` does not exist.

**Step 3: Implement the client**

Provide these public concepts:

```ts
export type ActivityHistoryKind = 'chat' | 'resource';
export const RESOURCE_SOURCES = [
  'document',
  'recording',
  'project_context',
  'project_memory',
  'tracker_task',
] as const;

export interface ActivityHistoryFilters {
  q?: string;
  period?: 'all' | 'today' | '7d' | '30d';
  platform?: string;
  source?: string;
  hasMedia?: boolean;
}

export const iproActivityApi = {
  search(projectId, kind, filters, cursor?),
  facets(projectId, kind, filters),
  context(projectId, messageId),
};
```

Serialize repeated `sources` parameters, set `sort=desc` and `limit=50`, calculate period start dates, and throw Japanese errors for non-2xx responses.

**Step 4: Verify GREEN**

Run the same focused test. Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/lib/ipro-activity.ts frontend/src/lib/ipro-activity.test.ts
git commit -m "feat(frontend): add ipro activity history client"
```

### Task 2: Build the shared received-history view

**Files:**
- Create: `frontend/src/components/knowledge/activity-history-view.test.tsx`
- Create: `frontend/src/components/knowledge/activity-history-view.tsx`

**Step 1: Write the failing component tests**

Mock only the network client boundary. Cover:

```tsx
it('renders chat results and loads context when a message is selected', async () => {});
it('renders resource labels and metadata in the inspector', async () => {});
it('applies search and period filters before reloading', async () => {});
it('appends the next cursor page without dropping current results', async () => {});
it('shows actionable empty and error states', async () => {});
```

**Step 2: Verify RED**

```bash
cd frontend
./node_modules/.bin/vitest run src/components/knowledge/activity-history-view.test.tsx
```

Expected: FAIL because the component is missing.

**Step 3: Implement the minimal shared component**

Use a `kind` prop and keep data loading inside the view:

```tsx
<ActivityHistoryView projectId={projectId} kind="chat" />
<ActivityHistoryView projectId={projectId} kind="resource" />
```

Implement:

- PageHeader with refresh action and fetched timestamp
- labelled full-text search
- period segmented control
- platform or source select
- media checkbox
- responsive timeline and inspector
- chat context loading
- resource metadata details
- cursor append loading
- first-load skeleton, retryable error, and instructive empty state

**Step 4: Verify GREEN and refactor**

Run the focused component and client tests. Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/components/knowledge/activity-history-view.tsx frontend/src/components/knowledge/activity-history-view.test.tsx
git commit -m "feat(frontend): add received activity history view"
```

### Task 3: Add Chat History and Resource History pages

**Files:**
- Create: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/knowledge/chat-history/page.tsx`
- Create: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/knowledge/resource-history/page.tsx`

**Step 1: Add a failing page wiring test**

Extend the component test with a lightweight assertion that both supported `kind` values expose distinct title, description, empty copy, and filter labels. Verify it fails until configuration is exported.

**Step 2: Implement thin route entries**

Each page reads `projectId` with `useParams` and renders the shared view with the correct kind. Keep route files free of duplicated fetching logic.

**Step 3: Run tests and frontend TypeScript**

```bash
cd frontend
./node_modules/.bin/vitest run src/lib/ipro-activity.test.ts src/components/knowledge/activity-history-view.test.tsx
./node_modules/.bin/tsc --noEmit
```

Expected: PASS.

**Step 4: Commit**

```bash
git add 'frontend/src/app/(dashboard)/dashboard/projects/[projectId]/knowledge/chat-history/page.tsx' 'frontend/src/app/(dashboard)/dashboard/projects/[projectId]/knowledge/resource-history/page.tsx' frontend/src/components/knowledge/activity-history-view.test.tsx
git commit -m "feat(frontend): add chat and resource history pages"
```

### Task 4: Reorganize project navigation

**Files:**
- Create: `frontend/src/lib/knowledge-navigation.test.ts`
- Create: `frontend/src/lib/knowledge-navigation.ts`
- Modify: `frontend/src/app/(dashboard)/layout.tsx`

**Step 1: Write the failing navigation test**

Assert that:

```ts
expect(buildKnowledgeNavigation('p1').background.items.map(i => i.name))
  .toEqual(['背景・目的']);
expect(buildKnowledgeNavigation('p1').knowledge.items.map(i => i.name))
  .toEqual([
    'チャット履歴',
    'リソース履歴',
    'ナレッジ取り込み',
    'ナレッジグラフ',
    'ナレッジ一覧編集',
    'RAG索引',
    'ナレッジ設定',
  ]);
```

Also assert every href is project-scoped.

**Step 2: Verify RED**

Run the focused test. Expected: FAIL because the builder is missing.

**Step 3: Implement and consume the builder**

Move only the Background/Knowledge descriptors out of the layout. Preserve existing icons, children for Knowledge List, active-state behavior, mobile navigation close behavior, and collapsed sidebar rendering.

**Step 4: Verify GREEN**

Run the navigation test and all frontend tests. Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/lib/knowledge-navigation.ts frontend/src/lib/knowledge-navigation.test.ts 'frontend/src/app/(dashboard)/layout.tsx'
git commit -m "feat(frontend): add standalone knowledge navigation"
```

### Task 5: Verify production readiness and visual behavior

**Files:**
- Modify only if verification exposes a tested issue.

**Step 1: Run automated verification**

```bash
cd frontend
./node_modules/.bin/vitest run
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/next build

cd ../backend
./node_modules/.bin/jest ipro-chat-history --runInBand
./node_modules/.bin/tsc --noEmit
```

Expected: all PASS.

**Step 2: Run visual checks**

Start the frontend against an available local API or mocked data, then inspect:

- expanded and collapsed sidebar
- 1440px two-column history layout
- 768px compressed layout
- 390px single-column layout
- keyboard focus and selection
- loading, empty, error, populated, and context states

Use @browser:control-in-app-browser for browser inspection when a local server is available.

**Step 3: Review the final diff**

```bash
git diff --check
git status --short --branch
git log --oneline --decorate -8
```

Expected: clean intended changes only.

**Step 4: Finish the branch**

Use @requesting-code-review, @verification-before-completion, and @finishing-a-development-branch. Respect the current session rule that forbids subagents unless the user explicitly requests delegation; apply the code-review checklist directly if delegation remains unavailable.
