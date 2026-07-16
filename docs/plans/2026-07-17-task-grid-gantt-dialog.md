# Task Grid and Gantt Dialog Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** タスク一覧をリサイズ可能なExcel風グリッドへ変更し、ガントの編集モーダルと日・1週・2週・1か月の横軸切替を通常／全画面の両方で提供する。

**Architecture:** TanStack Tableを既存の階層ソート・フィルタ済みデータの描画層として導入し、表示密度と列幅を管理する。ガントは既存編集状態とAPIを維持したままRadix Dialogへ表示を移し、Frappe Ganttへ独自の14日表示モードを渡す。

**Tech Stack:** Next.js 14、React 18、TypeScript、TanStack Table v8、Radix Tooltip/Dialog、Tailwind CSS、Frappe Gantt、Vitest

---

### Task 1: 表示ロジックのテストと依存関係

**Files:**
- Modify: `frontend/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `frontend/src/components/tasks/task-grid-state.ts`
- Create: `frontend/src/components/tasks/task-grid-state.test.ts`

**Step 1: Write the failing test**

省略判定が `scrollWidth > clientWidth` のときだけtrueになること、タスク表の列キーと初期幅が固定順で返ることをテストする。

**Step 2: Run test to verify it fails**

Run: `pnpm --filter frontend test -- src/components/tasks/task-grid-state.test.ts`
Expected: FAIL because the module does not exist.

**Step 3: Write minimal implementation**

`isTextOverflowing` と列幅定義を実装し、`@tanstack/react-table` をfrontend依存へ追加する。

**Step 4: Run test to verify it passes**

Run: `pnpm --filter frontend test -- src/components/tasks/task-grid-state.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/package.json pnpm-lock.yaml frontend/src/components/tasks/task-grid-state.ts frontend/src/components/tasks/task-grid-state.test.ts
git commit -m "test: define task grid sizing behavior"
```

### Task 2: Excel風タスクグリッド

**Files:**
- Create: `frontend/src/components/tasks/OverflowTooltipText.tsx`
- Create: `frontend/src/components/tasks/TaskSpreadsheetTable.tsx`
- Modify: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/tasks/page.tsx`

**Step 1: Write the failing test**

Task 1の列定義テストへ、タイトル列がリサイズ可能で最小幅を下回らないこと、操作列が末尾に固定されることを追加する。

**Step 2: Run test to verify it fails**

Run: `pnpm --filter frontend test -- src/components/tasks/task-grid-state.test.ts`
Expected: FAIL on the new sizing assertions.

**Step 3: Write minimal implementation**

TanStack Tableで11列を描画する。タイトル・担当・エピック・スプリントなどは1行省略し、`OverflowTooltipText` で省略時だけ全文を表示する。ヘッダーのドラッグリサイズ、ダブルクリック初期化、sticky header、横スクロールを追加する。既存の検索・6フィルタ・3段階ソート・WBS階層・インライン状態編集・編集／削除操作を接続する。

**Step 4: Run test to verify it passes**

Run: `pnpm --filter frontend test -- src/components/tasks/task-grid-state.test.ts src/lib/tasks.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/components/tasks frontend/src/app/'(dashboard)'/dashboard/projects/'[projectId]'/tasks/page.tsx
git commit -m "feat: render tasks in a resizable data grid"
```

### Task 3: ガント横軸4段階

**Files:**
- Create: `frontend/src/components/gantt/gantt-view-modes.ts`
- Create: `frontend/src/components/gantt/gantt-view-modes.test.ts`
- Modify: `frontend/src/types/frappe-gantt.d.ts`
- Modify: `frontend/src/components/gantt/FrappeGantt.tsx`
- Modify: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/tasks/gantt/page.tsx`

**Step 1: Write the failing test**

日・1週・2週・1か月の順で選択肢が定義され、2週モードが `step: '14d'`、`snap_at: '7d'` を持つことをテストする。

**Step 2: Run test to verify it fails**

Run: `pnpm --filter frontend test -- src/components/gantt/gantt-view-modes.test.ts`
Expected: FAIL because the module does not exist.

**Step 3: Write minimal implementation**

Frappeの表示モード型をオブジェクト定義へ拡張し、`['Day', 'Week', twoWeeksMode, 'Month']` をwrapperへ渡す。ガントカード内に切替ツールバーを置き、通常・全画面のどちらでも同じReact stateを操作できるようにする。

**Step 4: Run test to verify it passes**

Run: `pnpm --filter frontend test -- src/components/gantt/gantt-view-modes.test.ts src/lib/gantt.test.ts src/components/gantt/frappe-scroll.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/components/gantt frontend/src/types/frappe-gantt.d.ts frontend/src/app/'(dashboard)'/dashboard/projects/'[projectId]'/tasks/gantt/page.tsx
git commit -m "feat: add four gantt timeline scales"
```

### Task 4: ガント編集モーダル

**Files:**
- Modify: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/tasks/gantt/page.tsx`

**Step 1: Write the failing test**

サイドバー固有状態を純粋化した小さな状態テスト、または型検査で、選択タスクがDialogのopen状態へ対応することを確認できる形にする。

**Step 2: Run test to verify it fails**

Run: `pnpm --filter frontend test -- src/components/gantt/gantt-view-modes.test.ts`
Expected: FAIL until the exported modal-state helper or expected configuration is present.

**Step 3: Write minimal implementation**

右サイドバーと独自バックドロップをRadix Dialogへ置換する。既存フォーム、保存、詳細ページリンク、読み取り専用制御を維持し、Dialog contentを全画面ガントより高いz-indexへ置く。画面説明とHowToの文言をモーダル・4段階表示へ更新する。

**Step 4: Run test to verify it passes**

Run: `pnpm --filter frontend test -- src/components/gantt/gantt-view-modes.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/app/'(dashboard)'/dashboard/projects/'[projectId]'/tasks/gantt/page.tsx frontend/src/components/gantt
git commit -m "feat: edit gantt tasks in a modal"
```

### Task 5: 統合検証

**Files:**
- Modify only if verification exposes a defect.

**Step 1: Run focused tests**

Run: `pnpm --filter frontend test -- src/components/tasks/task-grid-state.test.ts src/components/gantt/gantt-view-modes.test.ts src/lib/tasks.test.ts src/lib/gantt.test.ts`
Expected: PASS.

**Step 2: Run the full frontend suite**

Run: `pnpm --filter frontend test`
Expected: all test files and tests pass.

**Step 3: Run production checks**

Run: `pnpm --filter frontend check:secrets && pnpm --filter frontend build && git diff --check`
Expected: all commands exit 0.

**Step 4: Browser verification**

公開画面またはローカル画面で、長いタイトルの1行省略と省略時Tooltip、列幅ドラッグ、ソート・フィルタ、ガントの4段階切替、通常／全画面での編集モーダルを確認する。

**Step 5: Commit fixes if needed**

```bash
git add frontend docs/plans
git commit -m "fix: polish task grid and gantt interactions"
```
