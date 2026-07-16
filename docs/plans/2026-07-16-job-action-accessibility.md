# Job Action Accessibility Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 親子ジョブと文書ページの再開・再試行操作を識別しやすく、44px以上のヒット領域にする。

**Architecture:** 既存のbutton要素とイベント処理は変えず、ARIAラベルに親ジョブ文脈を加え、Tailwindの最小寸法クラスを付与する。RTLでDOM上のラベルとクラスを直接検証する。

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest, React Testing Library

---

### Task 1: RTLで期待するアクセシビリティ契約を固定する

**Files:**
- Modify: `frontend/src/components/background-jobs-panel.test.tsx`
- Modify: `frontend/src/components/knowledge/NodeDetailPanel.test.tsx`

**Step 1: Write the failing test**

親再開、子再試行、文書ページ再試行のbuttonに `min-h-11 min-w-11` があり、子再試行のARIAラベルが `資料取り込み root-1 のスライド 2を再試行` になることをassertする。

**Step 2: Run test to verify it fails**

Run: `npm test -- --run src/components/background-jobs-panel.test.tsx src/components/knowledge/NodeDetailPanel.test.tsx`

Expected: 現在の子ARIAラベルまたは不足する最小寸法クラスによりFAIL。

### Task 2: 最小のUI変更を実装する

**Files:**
- Modify: `frontend/src/components/background-jobs-panel.tsx`
- Modify: `frontend/src/components/knowledge/NodeDetailPanel.tsx`

**Step 1: Write minimal implementation**

対象buttonの既存classNameへ `min-h-11 min-w-11` を追加し、子再試行ARIAラベルを `${typeLabel(job.type)} ${job.id} の${label}を再試行` に変更する。

**Step 2: Run test to verify it passes**

Run: `npm test -- --run src/components/background-jobs-panel.test.tsx src/components/knowledge/NodeDetailPanel.test.tsx`

Expected: 9 tests PASS。

### Task 3: 検証してcommitする

**Files:**
- Verify all files above

**Step 1: Run build**

Run: `npm run build`

Expected: Next.js production build exits 0。

**Step 2: Check diff**

Run: `git diff --check`

Expected: no output, exit 0。

**Step 3: Commit**

```bash
git add docs/plans/2026-07-16-job-action-accessibility*.md frontend/src/components/background-jobs-panel.tsx frontend/src/components/background-jobs-panel.test.tsx frontend/src/components/knowledge/NodeDetailPanel.tsx frontend/src/components/knowledge/NodeDetailPanel.test.tsx
git commit -m "fix(ui): improve job action accessibility"
```
