# 統合イシューツリー Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** イシューツリーを「型(WHY/SOLUTION)選択」廃止の1本に統合し、ノード種別(ISSUE/CAUSE/COUNTERMEASURE)で課題→なぜ→打ち手を種別連動ガイドで作れるようにする（作成エラーも解消）。

**Architecture:** スキーマ変更なし。既存 `IssueNode.kind/verification/recommendation` を活用。作成時にルート `ISSUE` ノードを自動生成し、フロントは型選択を外し、ノード選択時に種別連動の追加ボタン＋種別ごとの仕掛け(色/○×△/採用バッジ/確定→打ち手誘導)を出す。強制はしない。

**Tech Stack:** NestJS + Prisma(backend), Next.js + React Flow(@xyflow/react) mindmap(frontend), vitest, curl smoke.

**前提:** 走行中ワークフロー `wg0prtcds`（issue-tree/[treeId]/page.tsx を編集中）の **完了・コミット後** に着手。各フロントタスクは着手時に対象ファイルの最新状態を読んでからアンカーすること。仕様: `docs/superpowers/specs/2026-06-09-unified-issue-tree-design.md`。

ローカル: backend `npm run start:dev` :5021, frontend :3007, pg docker :5460, demo@iplot.local/password123。検証: `(cd backend && npx tsc --noEmit)` / `(cd frontend && npx tsc --noEmit && npm test)` 各0/PASS。

---

## File Structure

- `backend/src/application/use-cases/issue-tree/create-issue-tree.use-case.ts` — 作成時にルート ISSUE ノードを自動生成（IssueNode リポジトリ経由）。
- `backend/src/presentation/dto/issue-tree/create-issue-tree.dto.ts` — `type` を任意化（既定 WHY）。
- `backend/src/presentation/controllers/issue-tree.controller.ts` — create が `type` 未指定でも通るよう既定値。
- `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/issue-trees/page.tsx` — 作成ダイアログから型削除・一覧の型分類削除。
- `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/issue-trees/[treeId]/page.tsx` — 種別連動の追加ボタン・色分け・○×△/採用バッジ・確定→打ち手誘導・種別変更。
- 既存 `frontend/src/lib`（issue-tree API/型）, `components/issue-trees/ideation-assist-dialog.tsx` を活用。

---

## Task 1: 作成エラーの再現と根因特定

**Files:**
- Inspect: `backend/src/presentation/controllers/issue-tree.controller.ts`, `create-issue-tree.use-case.ts`, frontend `issue-trees/page.tsx` の作成 POST。

- [ ] **Step 1: バックエンド起動して作成を再現**

Run:
```bash
TOKEN=$(curl -s -X POST http://localhost:5021/api/auth/login -H 'Content-Type: application/json' -d '{"email":"demo@iplot.local","password":"password123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
curl -s -X POST "http://localhost:5021/api/projects/b8310746-320e-449c-96db-169f5a1017ee/issue-trees" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"type":"WHY","name":"テスト","rootQuestion":"テスト"}' -w "\nHTTP %{http_code}\n"
```
Expected: 実際の HTTP コードとエラーボディを記録（400/500 の別と message）。

- [ ] **Step 2: 根因をログで特定**

Run: `tail -40 /tmp/be_dev.log` でスタックを確認。想定: (a) `type` 必須バリデーション、(b) ルートノード不在で詳細ページ/再取得が落ちる、(c) 認可。根因を1つに確定してから次へ。

---

## Task 2: バックエンド — 作成時にルート ISSUE ノードを自動生成 + type 任意化

**Files:**
- Modify: `backend/src/presentation/dto/issue-tree/create-issue-tree.dto.ts`
- Modify: `backend/src/application/use-cases/issue-tree/create-issue-tree.use-case.ts`
- Modify: `backend/src/presentation/controllers/issue-tree.controller.ts`

- [ ] **Step 1: DTO の type を任意化（既定 WHY）**

`create-issue-tree.dto.ts` の `type` を任意に:
```ts
  @ApiPropertyOptional({ enum: IssueTreeTypeDto, default: 'WHY', description: 'ツリー型（互換用・既定WHY）' })
  @IsOptional()
  @IsEnum(IssueTreeTypeDto, { message: '型はWHYまたはSOLUTIONを指定してください' })
  type?: IssueTreeTypeDto;
```

- [ ] **Step 2: controller で type 既定値**

`issue-tree.controller.ts` の create で `type: dto.type ?? IssueTreeTypeDto.WHY` を渡す。

- [ ] **Step 3: use-case でルート ISSUE ノードを自動生成**

`CreateIssueTreeUseCase` に `IIssueNodeRepository`(ISSUE_NODE_REPOSITORY) を DI 追加。`type` を任意化（`type?: IssueTreeType` 既定 WHY）。tree.save 後、ルートノードを生成:
```ts
// 7. ルートノード（kind=ISSUE）を自動生成。ラベル = rootQuestion || name
const rootNode = IssueNode.create(
  {
    treeId: id,
    parentId: null,
    depth: 0,
    order: 0,
    label: (input.rootQuestion?.trim() || input.name).slice(0, 2000),
    kind: 'ISSUE',
    verification: 'NA',
    recommendation: 'NA',
  },
  this.issueNodeRepository.generateId(),
);
await this.issueNodeRepository.save(rootNode);
```
注: `IssueNode.create` / `IIssueNodeRepository` の正確なシグネチャは既存ファイルで確認して合わせること（per-node API は既存）。

- [ ] **Step 4: backend tsc + 再現コマンドで 201 を確認**

Run: `(cd backend && npx tsc --noEmit)` → 0。Step1 の curl を再実行 → HTTP 201、続けて `GET /api/issue-trees/<id>` に ISSUE ルートノードが1件含まれることを確認。

- [ ] **Step 5: Commit**

```bash
git add backend/src/application/use-cases/issue-tree/create-issue-tree.use-case.ts backend/src/presentation/dto/issue-tree/create-issue-tree.dto.ts backend/src/presentation/controllers/issue-tree.controller.ts
git commit -m "fix(issue-tree): 作成時にルートISSUEノード自動生成 + type任意化（作成エラー解消）"
```

---

## Task 3: フロント — 作成ダイアログから型を削除・一覧の型分類を撤去

**Files:**
- Modify: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/issue-trees/page.tsx`

- [ ] **Step 1: 作成ダイアログの型選択を削除**

型(なぜ型/打ち手型)の選択 UI と関連 state を撤去。残す入力 = ツリー名 / ルートの問い(任意) / GAP起点(任意)。POST body から `type` を外す（バックエンドが既定 WHY を補完）。

- [ ] **Step 2: 一覧の型フィルタ/分類を撤去**

`whyCount`/`solutionCount`/型タブ等を削除し、全ツリーを1つの一覧に。型バッジ表示も削除（または「課題ツリー」一律表示）。

- [ ] **Step 3: tsc + 作成 smoke**

Run: `(cd frontend && npx tsc --noEmit)` → 0。ブラウザ/curl で型なし作成 → 201、一覧に出る。

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/(dashboard)/dashboard/projects/[projectId]/issue-trees/page.tsx"
git commit -m "feat(issue-tree): 作成から型選択を撤去（統合ツリー化）"
```

---

## Task 4: フロント — 種別連動の追加ボタン（課題→なぜ→打ち手）

**Files:**
- Modify: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/issue-trees/[treeId]/page.tsx`（着手時に最新を読む）

ノードに既存の per-node 追加 API（`POST issue-trees/:treeId/nodes` 等、kind/verification/recommendation を受け付ける）を使う。

- [ ] **Step 1: 選択ノードの kind に応じた追加アクションを定義**

選択中ノードの `kind` で出すボタンを切替（addChild(parentId, kind) は既存の add-node 呼び出しに kind を渡す薄いラッパ）:
```tsx
function addActionsFor(kind: 'ISSUE'|'CAUSE'|'COUNTERMEASURE') {
  if (kind === 'ISSUE') return [
    { label: 'なぜ？（原因を追加）', childKind: 'CAUSE' as const },
    { label: '打ち手を追加', childKind: 'COUNTERMEASURE' as const },
  ];
  if (kind === 'CAUSE') return [
    { label: 'さらに なぜ？', childKind: 'CAUSE' as const },
    { label: '打ち手を追加', childKind: 'COUNTERMEASURE' as const, emphasizeWhenConfirmed: true },
  ];
  return [
    { label: '下位の打ち手', childKind: 'COUNTERMEASURE' as const },
    { label: 'タスク化', action: 'task' as const },
  ];
}
```

- [ ] **Step 2: 追加時に kind を渡す**

新規子ノード作成 API 呼び出しで `kind: childKind` を送る（CAUSE は verification 既定 NEEDS_HEARING か NA、COUNTERMEASURE は recommendation 既定 NA）。○確定(CAUSE)時は「打ち手を追加」ボタンを強調クラス（青背景）。

- [ ] **Step 3: tsc + 操作 smoke**

Run: `(cd frontend && npx tsc --noEmit)` → 0。課題ノードから「なぜ？」で CAUSE 追加、CAUSE から「打ち手を追加」で COUNTERMEASURE 追加が反映される。

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/(dashboard)/dashboard/projects/[projectId]/issue-trees/[treeId]/page.tsx"
git commit -m "feat(issue-tree): 種別連動の追加ボタン（課題→なぜ→打ち手）"
```

---

## Task 5: フロント — 種別ごとの仕掛け（色 / ○×△ / 採用バッジ / 種別変更）

**Files:**
- Modify: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/issue-trees/[treeId]/page.tsx`

- [ ] **Step 1: 種別カラー**

ノード描画に kind 別配色: ISSUE=ネイビー枠、CAUSE=アンバー枠、COUNTERMEASURE=エメラルド枠。凡例を画面端に表示。

- [ ] **Step 2: CAUSE の検証バッジ + 確定誘導**

CAUSE ノードに ○/×/△/要ヒアリング のトグル（既存 verification 更新 API）。○CONFIRMED で枠を確定色＋「打ち手を追加」を強調表示。evidence メモ欄。

- [ ] **Step 3: COUNTERMEASURE の推奨バッジ**

COUNTERMEASURE に 採用/保留/不採用（既存 recommendation 更新 API）。採用はタスク化導線を強調（既存 Task.issueNodeId 連携があれば再利用）。

- [ ] **Step 4: 種別の後付け変更**

ノード編集に kind セレクト（ISSUE/CAUSE/COUNTERMEASURE）を追加。取り違え救済。強制バリデーションはしない。

- [ ] **Step 5: tsc + npm test + smoke**

Run: `(cd frontend && npx tsc --noEmit && npm test)` → 0/PASS。CAUSE の○×△、COUNTERMEASURE の採用/保留/不採用、kind 変更が永続化される。

- [ ] **Step 6: Commit**

```bash
git add "frontend/src/app/(dashboard)/dashboard/projects/[projectId]/issue-trees/[treeId]/page.tsx"
git commit -m "feat(issue-tree): 種別別の色・○×△・採用バッジ・種別変更（ガイドするが強制しない）"
```

---

## Task 6: フロント — 発想アシスト/AI を CAUSE/COUNTERMEASURE 生成に接続（任意強化）

**Files:**
- Modify: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/issue-trees/[treeId]/page.tsx`, 既存 `components/issue-trees/ideation-assist-dialog.tsx`

- [ ] **Step 1: 既存「発想法で分解」を kind 対応に**

選択ノードの kind に応じて、生成した子候補の kind を CAUSE か COUNTERMEASURE に割当（ISSUE/CAUSE 選択時は原因候補=CAUSE、確定原因や打ち手選択時は打ち手候補=COUNTERMEASURE）。

- [ ] **Step 2: tsc + smoke + Commit**

Run: `(cd frontend && npx tsc --noEmit)` → 0。発想アシストから子候補を採用すると正しい kind で追加される。
```bash
git add "frontend/src/app/(dashboard)/dashboard/projects/[projectId]/issue-trees/[treeId]/page.tsx" frontend/src/components/issue-trees/ideation-assist-dialog.tsx
git commit -m "feat(issue-tree): 発想アシストの子候補を種別連動に"
```

---

## Task 7: 最終検証

- [ ] **Step 1: 全体検証**

Run: `(cd backend && npx tsc --noEmit)` → 0、`(cd frontend && npx tsc --noEmit && npm test)` → 0/PASS。

- [ ] **Step 2: ライブ smoke（型なし作成→なぜ→打ち手）**

curl/ブラウザで: 型なし作成 201（ルート ISSUE）→ CAUSE 追加→ ○確定 → COUNTERMEASURE 追加→ 採用。既存ツリーが壊れず開けること。

- [ ] **Step 3: メモリ更新 + 完了報告**

`methodology-pipeline-rebuild.md` に統合イシューツリー完了を追記。

---

## Self-Review メモ

- Spec の全節（型廃止/作成エラー/種別連動ガイド/色・○×△・採用/発想アシスト/移行）に対応タスクあり。
- backend は具体コード、frontend は対象ファイルが走行中ワークフローで変動中のため「最新を読んでアンカー」と明記（プレースホルダではなく制約の明示）。
- 型整合: childKind の union 'ISSUE'|'CAUSE'|'COUNTERMEASURE' を全タスクで統一。verification/recommendation の enum は既存 DB 値（CONFIRMED/REJECTED/UNKNOWN/NEEDS_HEARING/NA, ADOPT/HOLD/REJECT/NA）に合わせる。
