# DFD（データフロー図）機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 業務フローから多レベルDFD（第1=フロー群／第2=ノード群、ドリルダウン）を生成・編集し、SEC帳票風（色付き）で描画＋PNG出力、データフロー一覧表、帳票種別レジストリ＋具体帳票アップロードを提供する。

**Architecture:** 正規化モデル（DfdDiagram/DfdNode/DfdFlow/ReportType, 既存 flow-folder.* スライスをミラー）。第2レベルはフローのノード/エッジから、第1レベルはプロジェクトのフロー＋FlowNodeLinkから冪等生成。描画は React Flow（SwimlaneCanvas をミラー）＋html-to-image でPNG。帳票アップロードは既存 Attachment（task-attachment パターン）を reportTypeId で流用。

**Tech Stack:** NestJS + Prisma 5.x(postgres :5460), Next.js 14 app router, React 18, @xyflow/react v12, html-to-image, raw fetch + localStorage 'accessToken', vitest(pure fns), Tailwind(navy #050f3e/blue #2563eb/emerald #10b981)。

**Testing reality:** バックエンドのユニットテスト基盤は無い。ゲート = **tsc 0 / vitest(純粋関数) / ライブ curl**。Prisma/tsc/vitest はリポジトリルートの `node_modules/.bin`（`../node_modules/.bin/...`、npx不可）。

**Mirror references（実装時に読む）:** backend slice = `backend/src/**/flow-folder.*` と直近の `flow-definition.*`; React Flow + PNG = `frontend/src/components/flow-editor/SwimlaneCanvas.tsx`（`nodeTypes`, `toPng`）; アップロード = `backend/src/presentation/controllers/attachment.controller.ts`（`tasks/:taskId/attachments` POST/GET, `@Public attachments/:id/file`, DELETE）を report-type 版に複製; L1 のフロー間データフロー元 = `FlowNodeLink`(schema:366)。

**Conventions:** frontend `'use client'`, `API_URL=process.env.NEXT_PUBLIC_API_URL||'http://localhost:5021'`, token=localStorage 'accessToken', 共有 `@/components/ui` + PageHeader/HelpTooltip/HowToPanel。スモーク: login demo@iplot.local/password123, project `b8310746-320e-449c-96db-169f5a1017ee`。

---

## File Structure

**Backend（新規, flow-folder.* / flow-definition.* をミラー）**
- `backend/prisma/schema.prisma` — enum DfdNodeKind + models DfdDiagram/DfdNode/DfdFlow/ReportType + Attachment.reportTypeId + 各 back-relation。
- `backend/src/domain/entities/{dfd-diagram,dfd-node,dfd-flow,report-type}.entity.ts`
- `backend/src/domain/repositories/{dfd,report-type}.repository.ts`（DfdRepository は diagram/node/flow をまとめて扱う1 interface でよい）
- `backend/src/infrastructure/persistence/repositories/{dfd.repository.impl,report-type.repository.impl}.ts`
- `backend/src/application/use-cases/dfd/*`（get/generate/node-crud/flow-crud/positions）+ `report-type/*`
- `backend/src/presentation/controllers/{dfd.controller,report-type.controller}.ts`（+ attachment.controller に report-type 版ルート追記）
- 各 barrel + `app.module.ts`

**Frontend**
- `frontend/src/lib/dfd.ts` + `frontend/src/lib/dfd.test.ts`（型・API・純粋ヘルパー：採番/生成マッピング/一覧表row）
- `frontend/src/components/dfd/DfdCanvas.tsx`（React Flow 3ノード型＋境界＋帳票チャコール＋PNG）
- `frontend/src/components/dfd/DataFlowTable.tsx`（データフロー一覧表）
- `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/flows/[flowId]/page.tsx`（第2: 「DFD」タブ追加）
- `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/dfd/page.tsx`（第1: 新規）+ `layout.tsx`（サイドバー「DFD」）
- 帳票種別: `dfd` ページ内セクション or `frontend/src/components/dfd/ReportTypeRegistry.tsx`

---

# Phase 1 — モデル + 第2レベル生成 + 編集 + PNG + 一覧表

## Task 1: スキーマ（DFDモデル）

**Files:** Modify `backend/prisma/schema.prisma`

- [ ] **Step 1: enum + models + relations を追加**（spec のデータモデル節を転記）

`backend/prisma/schema.prisma` に追記:
```prisma
enum DfdNodeKind { FUNCTION EXTERNAL_ENTITY DATA_STORE }

model DfdDiagram {
  id          String   @id @default(uuid())
  projectId   String   @map("project_id")
  flowId      String?  @map("flow_id")
  title       String?
  docId       String?  @map("doc_id")
  authorName  String?  @map("author_name")
  approverName String? @map("approver_name")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  project Project       @relation(fields: [projectId], references: [id], onDelete: Cascade)
  flow    BusinessFlow? @relation("FlowDfd", fields: [flowId], references: [id], onDelete: Cascade)
  nodes   DfdNode[]
  flows   DfdFlow[]
  @@unique([projectId, flowId])
  @@map("dfd_diagrams")
}

model DfdNode {
  id         String      @id @default(uuid())
  diagramId  String      @map("diagram_id")
  kind       DfdNodeKind
  label      String
  number     String?
  refFlowId  String?     @map("ref_flow_id")
  refNodeId  String?     @map("ref_node_id")
  positionX  Float       @default(0) @map("position_x")
  positionY  Float       @default(0) @map("position_y")
  createdAt  DateTime    @default(now()) @map("created_at")
  updatedAt  DateTime    @updatedAt @map("updated_at")
  diagram    DfdDiagram    @relation(fields: [diagramId], references: [id], onDelete: Cascade)
  refFlow    BusinessFlow? @relation("DfdNodeRefFlow", fields: [refFlowId], references: [id], onDelete: SetNull)
  refNode    FlowNode?     @relation("DfdNodeRefNode", fields: [refNodeId], references: [id], onDelete: SetNull)
  outFlows   DfdFlow[]   @relation("DfdFlowSource")
  inFlows    DfdFlow[]   @relation("DfdFlowTarget")
  @@map("dfd_nodes")
}

model DfdFlow {
  id           String   @id @default(uuid())
  diagramId    String   @map("diagram_id")
  sourceNodeId String   @map("source_node_id")
  targetNodeId String   @map("target_node_id")
  dataItem     String   @map("data_item")
  reportTypeId String?  @map("report_type_id")
  order        Int      @default(0)
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")
  diagram    DfdDiagram  @relation(fields: [diagramId], references: [id], onDelete: Cascade)
  sourceNode DfdNode     @relation("DfdFlowSource", fields: [sourceNodeId], references: [id], onDelete: Cascade)
  targetNode DfdNode     @relation("DfdFlowTarget", fields: [targetNodeId], references: [id], onDelete: Cascade)
  reportType ReportType? @relation(fields: [reportTypeId], references: [id], onDelete: SetNull)
  @@map("dfd_flows")
}

model ReportType {
  id          String   @id @default(uuid())
  projectId   String   @map("project_id")
  name        String
  description String?  @db.Text
  order       Int      @default(0)
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  project     Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  dfdFlows    DfdFlow[]
  attachments Attachment[]
  @@map("report_types")
}
```
`Attachment` に追記: `reportTypeId String? @map("report_type_id")` ＋ `reportType ReportType? @relation(fields: [reportTypeId], references: [id], onDelete: Cascade)`。
back-relations: `Project` に `dfdDiagrams DfdDiagram[]` `reportTypes ReportType[]`；`BusinessFlow` に `dfd DfdDiagram? @relation("FlowDfd")` `dfdNodeRefs DfdNode[] @relation("DfdNodeRefFlow")`；`FlowNode` に `dfdNodeRefs DfdNode[] @relation("DfdNodeRefNode")`。

- [ ] **Step 2: validate/generate/push**

Run（`backend/`）: `../node_modules/.bin/prisma validate && ../node_modules/.bin/prisma generate && ../node_modules/.bin/prisma db push --skip-generate`
Expected: valid / Generated / in sync。

- [ ] **Step 3: Commit**
```bash
cd /Users/kazuyukijimbo/brain-pro && git add backend/prisma/schema.prisma
git commit -m "feat(dfd): schema (DfdDiagram/DfdNode/DfdFlow/ReportType + Attachment.reportTypeId)"
```

## Task 2: 純粋ヘルパー（採番・第2生成マッピング・一覧表row）+ vitest

**Files:** Create `frontend/src/lib/dfd.ts`, `frontend/src/lib/dfd.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`frontend/src/lib/dfd.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { assignFunctionNumbers, buildDataFlowRows, type DfdNode, type DfdFlow } from './dfd';

describe('assignFunctionNumbers', () => {
  it('FUNCTIONノードに 1-1,1-2… を順に付ける（番号既存はそのまま）', () => {
    const nodes: DfdNode[] = [
      { id: 'a', kind: 'FUNCTION', label: '受注', number: null, positionX: 0, positionY: 0 },
      { id: 'e', kind: 'EXTERNAL_ENTITY', label: '顧客', number: null, positionX: 0, positionY: 0 },
      { id: 'b', kind: 'FUNCTION', label: '出荷', number: '1-9', positionX: 0, positionY: 0 },
    ];
    const out = assignFunctionNumbers(nodes, 1);
    expect(out.find((n) => n.id === 'a')!.number).toBe('1-1');
    expect(out.find((n) => n.id === 'b')!.number).toBe('1-9'); // 既存維持
    expect(out.find((n) => n.id === 'e')!.number).toBeNull();  // 非FUNCTIONは付けない
  });
});

describe('buildDataFlowRows', () => {
  it('DfdFlow を 源泉/データ項目/宛先/方向 の行に変換', () => {
    const nodes: DfdNode[] = [
      { id: 'ext', kind: 'EXTERNAL_ENTITY', label: '顧客', number: null, positionX: 0, positionY: 0 },
      { id: 'fn', kind: 'FUNCTION', label: '受注登録', number: '1-1', positionX: 0, positionY: 0 },
    ];
    const flows: DfdFlow[] = [
      { id: 'f1', sourceNodeId: 'ext', targetNodeId: 'fn', dataItem: '受注データ', reportTypeId: null, order: 0 },
    ];
    const rows = buildDataFlowRows(nodes, flows);
    expect(rows).toEqual([
      { no: 1, source: '顧客', dataItem: '受注データ', target: '受注登録', direction: 'IN', relatedFunction: '受注登録', reportTypeId: null },
    ]);
  });
});
```

- [ ] **Step 2: 失敗確認**

Run（`frontend/`）: `../node_modules/.bin/vitest run src/lib/dfd.test.ts` → FAIL（未定義）。

- [ ] **Step 3: 実装**

`frontend/src/lib/dfd.ts`:
```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

export type DfdNodeKind = 'FUNCTION' | 'EXTERNAL_ENTITY' | 'DATA_STORE';
export interface DfdNode {
  id: string; kind: DfdNodeKind; label: string; number: string | null;
  refFlowId?: string | null; refNodeId?: string | null;
  positionX: number; positionY: number;
}
export interface DfdFlow {
  id: string; sourceNodeId: string; targetNodeId: string;
  dataItem: string; reportTypeId: string | null; order: number;
}
export interface DfdDiagram {
  id: string; projectId: string; flowId: string | null;
  title: string | null; docId: string | null; authorName: string | null; approverName: string | null;
  updatedAt: string; nodes: DfdNode[]; flows: DfdFlow[];
}

/** FUNCTIONノードに levelPrefix-連番 を採番（既存numberは保持） */
export function assignFunctionNumbers(nodes: DfdNode[], levelPrefix: number): DfdNode[] {
  let seq = 0;
  return nodes.map((n) => {
    if (n.kind !== 'FUNCTION') return n;
    seq += 1;
    return { ...n, number: n.number ?? `${levelPrefix}-${seq}` };
  });
}

export interface DataFlowRow {
  no: number; source: string; dataItem: string; target: string;
  direction: 'IN' | 'OUT'; relatedFunction: string; reportTypeId: string | null;
}
/** データフロー一覧表の行を作る。方向: 宛先がFUNCTIONならIN、源泉がFUNCTIONならOUT。関連処理=FUNCTION側ラベル */
export function buildDataFlowRows(nodes: DfdNode[], flows: DfdFlow[]): DataFlowRow[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  return flows
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((f, i) => {
      const s = byId.get(f.sourceNodeId);
      const t = byId.get(f.targetNodeId);
      const targetIsFn = t?.kind === 'FUNCTION';
      const fn = targetIsFn ? t : s?.kind === 'FUNCTION' ? s : t;
      return {
        no: i + 1,
        source: s?.label ?? '?',
        dataItem: f.dataItem,
        target: t?.label ?? '?',
        direction: targetIsFn ? 'IN' : 'OUT',
        relatedFunction: fn?.label ?? '',
        reportTypeId: f.reportTypeId,
      };
    });
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}
export const dfdApi = {
  async getByFlow(flowId: string): Promise<DfdDiagram> {
    const res = await fetch(`${API_URL}/api/business-flows/${flowId}/dfd`, { headers: headers() });
    if (!res.ok) throw new Error('DFD取得に失敗しました');
    return res.json();
  },
  async generateByFlow(flowId: string): Promise<DfdDiagram> {
    const res = await fetch(`${API_URL}/api/business-flows/${flowId}/dfd`, { method: 'POST', headers: headers() });
    if (!res.ok) throw new Error('DFD生成に失敗しました');
    return res.json();
  },
  async getByProject(projectId: string): Promise<DfdDiagram> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/dfd`, { headers: headers() });
    if (!res.ok) throw new Error('DFD取得に失敗しました');
    return res.json();
  },
  async generateByProject(projectId: string): Promise<DfdDiagram> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/dfd`, { method: 'POST', headers: headers() });
    if (!res.ok) throw new Error('DFD生成に失敗しました');
    return res.json();
  },
  async addNode(diagramId: string, body: Partial<DfdNode> & { kind: DfdNodeKind; label: string }): Promise<DfdNode> {
    const res = await fetch(`${API_URL}/api/dfd-diagrams/${diagramId}/nodes`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error('ノード追加に失敗しました');
    return res.json();
  },
  async updateNode(id: string, patch: Partial<DfdNode>): Promise<DfdNode> {
    const res = await fetch(`${API_URL}/api/dfd-nodes/${id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(patch) });
    if (!res.ok) throw new Error('ノード更新に失敗しました');
    return res.json();
  },
  async deleteNode(id: string): Promise<void> { await fetch(`${API_URL}/api/dfd-nodes/${id}`, { method: 'DELETE', headers: headers() }); },
  async addFlow(diagramId: string, body: { sourceNodeId: string; targetNodeId: string; dataItem: string }): Promise<DfdFlow> {
    const res = await fetch(`${API_URL}/api/dfd-diagrams/${diagramId}/flows`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error('データフロー追加に失敗しました');
    return res.json();
  },
  async updateFlow(id: string, patch: Partial<DfdFlow>): Promise<DfdFlow> {
    const res = await fetch(`${API_URL}/api/dfd-flows/${id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(patch) });
    if (!res.ok) throw new Error('データフロー更新に失敗しました');
    return res.json();
  },
  async deleteFlow(id: string): Promise<void> { await fetch(`${API_URL}/api/dfd-flows/${id}`, { method: 'DELETE', headers: headers() }); },
  async savePositions(diagramId: string, positions: { id: string; positionX: number; positionY: number }[]): Promise<void> {
    await fetch(`${API_URL}/api/dfd-diagrams/${diagramId}/positions`, { method: 'PUT', headers: headers(), body: JSON.stringify({ positions }) });
  },
};
```

- [ ] **Step 4: テスト通過 + Commit**

Run（`frontend/`）: `../node_modules/.bin/vitest run`（既存72 + 新規 green）。
```bash
git add frontend/src/lib/dfd.ts frontend/src/lib/dfd.test.ts
git commit -m "feat(dfd): frontend lib + pure helpers (numbering/dataflow-rows) + vitest"
```

## Task 3: バックエンド DFD スライス（diagram/node/flow + 第2生成）

**Files:** domain entities `dfd-diagram/dfd-node/dfd-flow.entity.ts`, repo `dfd.repository.ts` + impl, use-cases under `application/use-cases/dfd/`, controller `dfd.controller.ts`, barrels, app.module。`flow-folder.*`/`flow-definition.*` をミラー。

- [ ] **Step 1: エンティティ + リポジトリ interface**

3エンティティ（private ctor + create/reconstruct + 更新メソッド + touch()）。`DfdRepository`（interface, `DFD_REPOSITORY` Symbol）は diagram/node/flow をまとめて扱う:
```typescript
// backend/src/domain/repositories/dfd.repository.ts
import { DfdDiagram } from '../entities/dfd-diagram.entity';
import { DfdNode } from '../entities/dfd-node.entity';
import { DfdFlow } from '../entities/dfd-flow.entity';
export const DFD_REPOSITORY = Symbol('DFD_REPOSITORY');
export interface DfdGraph { diagram: DfdDiagram; nodes: DfdNode[]; flows: DfdFlow[]; }
export interface IDfdRepository {
  findGraphByProjectFlow(projectId: string, flowId: string | null): Promise<DfdGraph | null>;
  createDiagram(d: DfdDiagram): Promise<void>;
  saveNode(n: DfdNode): Promise<void>;
  findNodeById(id: string): Promise<DfdNode | null>;
  deleteNode(id: string): Promise<void>;
  saveFlow(f: DfdFlow): Promise<void>;
  findFlowById(id: string): Promise<DfdFlow | null>;
  deleteFlow(id: string): Promise<void>;
  bulkSavePositions(diagramId: string, positions: { id: string; positionX: number; positionY: number }[]): Promise<void>;
  generateId(): string;
}
```
Prisma impl: `findGraphByProjectFlow` は `dfdDiagram.findFirst({ where:{ projectId, flowId } , include:{ nodes:true, flows:true } })`（flowId=null も findFirst で扱える）。

- [ ] **Step 2: ユースケース（第2の get-or-generate）**

`get-flow-dfd.use-case.ts`（flow→project→isMember 認可; diagram無ければ作る）と `generate-flow-dfd.use-case.ts`（冪等同期）:
- 生成規則(第2): そのフローの FlowNode 群 → FUNCTION ノード（refNodeId, label=node.label, number 自動）; FlowEdge(node→node) → DfdFlow（dataItem = edge.label || 送信元ノードの metadata.output || '情報'）。既存の手動ノード(外部実体/データストア)・位置・帳票参照は保持し、FUNCTIONの過不足のみ同期（refNodeId で突合）。
- get は graph 無ければ空 diagram を作って返す。POST(generate) は同期実行して返す。
- node/flow CRUD + positions ユースケース。
レスポンス整形 `dfd.output.ts`（DfdGraph → {id,projectId,flowId,title,docId,authorName,approverName,updatedAt,nodes[],flows[]}）。

- [ ] **Step 3: コントローラ**

`dfd.controller.ts`（`@CurrentUser`, inline DTO）:
- `GET business-flows/:flowId/dfd`（第2 get-or-create）, `POST business-flows/:flowId/dfd`（第2 generate/sync）
- `GET projects/:projectId/dfd`, `POST projects/:projectId/dfd`（第1, Phase 2 で生成規則実装。Phase1では空 get-or-create だけ用意してよい）
- `POST dfd-diagrams/:diagramId/nodes`, `PATCH dfd-nodes/:id`, `DELETE dfd-nodes/:id`
- `POST dfd-diagrams/:diagramId/flows`, `PATCH dfd-flows/:id`, `DELETE dfd-flows/:id`
- `PUT dfd-diagrams/:diagramId/positions` { positions:[{id,positionX,positionY}] }
barrels + app.module 配線。

- [ ] **Step 4: tsc + スモーク**

Run（`backend/`）: `../node_modules/.bin/tsc --noEmit -p tsconfig.json` → 0。
スモーク:
```bash
API=http://localhost:5021
TOK=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' -d '{"email":"demo@iplot.local","password":"password123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')
PID=b8310746-320e-449c-96db-169f5a1017ee
FLOW=$(curl -s "$API/api/business-flows/project/$PID/all" -H "Authorization: Bearer $TOK" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if d else "")')
curl -s -o /dev/null -w "POST flow dfd(gen): %{http_code}\n" -X POST "$API/api/business-flows/$FLOW/dfd" -H "Authorization: Bearer $TOK"
curl -s "$API/api/business-flows/$FLOW/dfd" -H "Authorization: Bearer $TOK" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("nodes",len(d["nodes"]),"flows",len(d["flows"]))'
```
Expected: `POST 200/201`、nodes はそのフローのノード数。

- [ ] **Step 5: Commit**
```bash
git add backend/src && git commit -m "feat(dfd): backend slice (diagram/node/flow + level-2 generate) + wiring"
```

## Task 4: DfdCanvas（SEC帳票風＋色, React Flow）+ 第2タブ + PNG

**Files:** Create `frontend/src/components/dfd/DfdCanvas.tsx`; Modify `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/flows/[flowId]/page.tsx`

- [ ] **Step 1: DfdCanvas 実装**（`SwimlaneCanvas.tsx` の nodeTypes/useNodesState/onNodesChange/toPng をミラー）

`frontend/src/components/dfd/DfdCanvas.tsx`（'use client'）:
- props: `diagram: DfdDiagram`, `onUpdateNode/onAddNode/onDeleteNode/onAddFlow/onUpdateFlow/onDeleteFlow/onSavePositions`, `onFunctionOpen?(refFlowId)`（第1のドリルダウン用, 任意）。
- React Flow カスタム nodeTypes: `function`(楕円, navy枠, 番号＋label), `external`(四角, slate), `datastore`(開いた四角 `=`, emerald)。`edgeTypes`: ラベル付き矢印（dataItem＋帳票チップ）。
- 破線楕円のシステム境界（背景レイヤ）＋凡例パネル＋帳票ヘッダ（title/docId/作成日付=updatedAtでも可/作成者/承認者; 編集可能なら inline）。
- ノードドラッグ → onSavePositions（SwimlaneCanvas のドラッグ保存をミラー）。ツールバー: 外部実体追加 / データストア追加 / 再生成 / **PNG出力**（`toPng` で帳票全体を画像化, SwimlaneCanvas:618 と同じ要領）。
- onConnect → onAddFlow（dataItem は仮入力→編集）。

- [ ] **Step 2: 第2「DFD」タブを追加**

`flows/[flowId]/page.tsx`（READ; フロー図/個別定義/情報の地図タブ構成）に「DFD」タブを追加。タブ内: マウントで `dfdApi.getByFlow(flowId)` → 無ノード時は「DFDを生成」ボタン(`generateByFlow`)。`<DfdCanvas diagram .../>` をレンダリングし、各操作を dfdApi に配線（addNode/updateNode/.../savePositions）。`onFunctionOpen` は第2では未使用。

- [ ] **Step 3: tsc + vitest**

Run（`frontend/`）: `rm -rf .next/types; ../node_modules/.bin/tsc --noEmit -p tsconfig.json` → 0; `../node_modules/.bin/vitest run` green。

- [ ] **Step 4: Commit**
```bash
git add frontend/src/components/dfd "frontend/src/app/(dashboard)/dashboard/projects/[projectId]/flows/[flowId]/page.tsx"
git commit -m "feat(dfd): DfdCanvas (SEC帳票風+色) + 第2レベルDFDタブ + PNG出力"
```

## Task 5: データフロー一覧表

**Files:** Create `frontend/src/components/dfd/DataFlowTable.tsx`; use in the DFD tab.

- [ ] **Step 1: 実装**

`DataFlowTable.tsx`: props `diagram`。`buildDataFlowRows(diagram.nodes, diagram.flows)` で行を作り表描画（No./源泉/データ項目/宛先/方向/関連処理/帳票種別[Phase3で名前表示]）。`overflow-x-auto`、白テーマ。第2タブに「図 / 一覧表」サブ切替を置き、一覧表側でこれを表示。

- [ ] **Step 2: tsc + Commit**

Run（`frontend/`）: tsc 0。
```bash
git add frontend/src/components/dfd/DataFlowTable.tsx "frontend/src/app/(dashboard)/dashboard/projects/[projectId]/flows/[flowId]/page.tsx"
git commit -m "feat(dfd): データフロー一覧表ビュー"
```

---

# Phase 2 — 第1レベル + ドリルダウン

## Task 6: 第1レベル生成（フロー＋FlowNodeLink）

**Files:** Modify `application/use-cases/dfd/generate-*`（第1ロジック）+ controller `POST/GET projects/:projectId/dfd`

- [ ] **Step 1: 第1生成ロジック**

`generate-project-dfd.use-case.ts`: project→isMember。第1 diagram（flowId=null）を `findFirst({projectId, flowId:null})` で get-or-create（spec の NULL一意性注記）。
- FUNCTION ノード = プロジェクトの BusinessFlow 群（refFlowId, label=flow.name, number 自動 1-1…, 既存保持）。
- データフロー = `FlowNodeLink`（ノード間クロスフローリンク）を「source側ノードの所属フロー(refFlowId) → targetFlowId(refFlowId)」へ畳む。dataItem = link.label || 既定。重複(同 source/target/dataItem)は集約。両端の FUNCTION ノードへ DfdFlow を張る。
- 外部実体/データストア・位置・編集は保持、FUNCTIONの過不足のみ同期。

- [ ] **Step 2: tsc + スモーク**

Run（`backend/`）: tsc 0。
```bash
API=http://localhost:5021; TOK=...(同上); PID=b8310746-...
curl -s -o /dev/null -w "POST project dfd: %{http_code}\n" -X POST "$API/api/projects/$PID/dfd" -H "Authorization: Bearer $TOK"
curl -s "$API/api/projects/$PID/dfd" -H "Authorization: Bearer $TOK" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("functions",sum(1 for n in d["nodes"] if n["kind"]=="FUNCTION"))'
```
Expected: 200、functions = プロジェクトのフロー数。

- [ ] **Step 3: Commit** `git add backend/src && git commit -m "feat(dfd): 第1レベル生成(フロー+FlowNodeLink)"`

## Task 7: 第1レベルDFDページ + サイドバー + ドリルダウン

**Files:** Create `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/dfd/page.tsx`; Modify `layout.tsx`

- [ ] **Step 1: /dfd ページ**

`dfd/page.tsx`（'use client'）: `dfdApi.getByProject(projectId)` → 無ければ「生成」ボタン。`<DfdCanvas diagram onFunctionOpen={(refFlowId)=>router.push(\`/dashboard/projects/${projectId}/flows/${refFlowId}?tab=dfd\`)} ... />`（FUNCTIONノードのダブルクリック/「開く」で第2へドリルダウン）。PageHeader('DFD（第1レベル）', backHref=プロジェクト) + HelpTooltip + HowToPanel。

- [ ] **Step 2: ドリルダウンの受け口（第2側パンくず）**

`flows/[flowId]/page.tsx`: `?tab=dfd` を読み初期タブをDFDに。DFDタブ上部に「プロジェクトDFD ＞ {フロー名}」パンくず（プロジェクトDFDへ戻るリンク `/dashboard/projects/${projectId}/dfd`）。

- [ ] **Step 3: サイドバー**

`layout.tsx`（現状把握 or 設計グループ）に「DFD」項目 → `/dashboard/projects/${projectId}/dfd`（icon 例 Workflow/Share2/Network）。

- [ ] **Step 4: tsc + Commit**

Run（`frontend/`）: `rm -rf .next/types; tsc` 0; vitest green。
```bash
git add "frontend/src/app/(dashboard)/dashboard/projects/[projectId]/dfd/page.tsx" "frontend/src/app/(dashboard)/dashboard/projects/[projectId]/flows/[flowId]/page.tsx" "frontend/src/app/(dashboard)/layout.tsx"
git commit -m "feat(dfd): 第1レベルDFDページ + サイドバー + ドリルダウン"
```

---

# Phase 3 — 帳票種別レジストリ + 具体帳票アップロード + 参照

## Task 8: ReportType バックエンド + 帳票アップロード（Attachment流用）

**Files:** `report-type.entity.ts` + repo + impl + use-cases(`report-type/*`) + `report-type.controller.ts`; Modify `attachment.controller.ts`(report-type版ルート), app.module

- [ ] **Step 1: ReportType スライス**（flow-folder.* ミラー）

CRUD: `GET/POST projects/:projectId/report-types`, `PATCH/DELETE report-types/:id`。authz project→isMember。出力に attachments 件数を含めてよい。

- [ ] **Step 2: 帳票アップロード（既存Attachment流用）**

`attachment.controller.ts`（READ; `tasks/:taskId/attachments` POST/GET, `@Public attachments/:id/file`, DELETE がある）に report-type 版を複製:
- `POST report-types/:reportTypeId/attachments`（multipart 'file'; reportTypeId をセットして Attachment 作成。projectId は reportType から解決）
- `GET report-types/:reportTypeId/attachments`（一覧）
- 配信(`attachments/:id/file` @Public)・削除(`attachments/:id`)は既存流用。

- [ ] **Step 3: tsc + スモーク**

Run（`backend/`）: tsc 0。
```bash
API=http://localhost:5021; TOK=...; PID=b8310746-...
RT=$(curl -s -X POST "$API/api/projects/$PID/report-types" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"name":"受注書"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
curl -s -o /dev/null -w "GET report-types: %{http_code}\n" "$API/api/projects/$PID/report-types" -H "Authorization: Bearer $TOK"
curl -s -o /dev/null -w "GET rt attachments: %{http_code}\n" "$API/api/report-types/$RT/attachments" -H "Authorization: Bearer $TOK"
```
Expected: 201/200/200。

- [ ] **Step 4: Commit** `git add backend/src && git commit -m "feat(dfd): ReportType slice + 帳票アップロード(Attachment流用)"`

## Task 9: 帳票種別UI + データフローからの参照

**Files:** Create `frontend/src/components/dfd/ReportTypeRegistry.tsx`; extend `frontend/src/lib/dfd.ts`(reportTypeApi); use in DFD pages (DfdCanvas edge + DataFlowTable)

- [ ] **Step 1: reportType API + UI**

`dfd.ts` に `reportTypeApi`（list/create/update/delete + listAttachments/upload(multipart)/deleteAttachment, fileUrl）。`ReportTypeRegistry.tsx`: 帳票種別の一覧/追加/編集/削除＋各種別に具体帳票ファイルのアップロード/DL(`${API_URL}/api/attachments/:id/file`)/削除。DFDページ（第1）に「帳票種別」セクションとして配置。

- [ ] **Step 2: データフローから帳票種別を参照**

DfdCanvas のエッジ編集（データフロー選択時）に「帳票種別」セレクタ（reportType一覧から選択）→ `dfdApi.updateFlow(id,{reportTypeId})`。矢印ラベルに帳票名チップ＋📎（種別に添付があれば）、クリックで添付一覧/DL。`DataFlowTable` の帳票種別列に名前表示＋📎。

- [ ] **Step 3: tsc + vitest + Commit**

Run（`frontend/`）: `rm -rf .next/types; tsc` 0; vitest green。
```bash
git add frontend/src/components/dfd frontend/src/lib/dfd.ts "frontend/src/app/(dashboard)/dashboard/projects/[projectId]/dfd/page.tsx"
git commit -m "feat(dfd): 帳票種別レジストリUI + データフローからの帳票参照"
```

---

## Task 10: 最終検証

- [ ] **Step 1: 全体 tsc + vitest**

Run:
```bash
cd /Users/kazuyukijimbo/brain-pro/backend && ../node_modules/.bin/tsc --noEmit -p tsconfig.json
cd /Users/kazuyukijimbo/brain-pro/frontend && rm -rf .next/types && ../node_modules/.bin/tsc --noEmit -p tsconfig.json && ../node_modules/.bin/vitest run
```
Expected: backend 0, frontend 0, vitest green（72 + dfd 新規）。

- [ ] **Step 2: ルート + API ライブ**
```bash
PID=b8310746-320e-449c-96db-169f5a1017ee
for r in dfd gap-items; do curl -s -o /dev/null -w "$r: %{http_code}\n" "http://localhost:3007/dashboard/projects/$PID/$r"; done
```
Expected: 200。第2は flows/[flowId] のDFDタブ目視。

- [ ] **Step 3: 仕様充足チェック**（第1/第2DFD・生成・編集・PNG・データフロー一覧表・帳票種別レジストリ＋アップロード＋参照 を目視）

---

## Self-Review notes
- **Spec coverage:** モデル(案A)=Task1; 第2生成+編集+PNG=Task3-4; 一覧表=Task5/Task2(pure); 第1+ドリルダウン=Task6-7; 帳票種別レジストリ+アップロード+参照=Task8-9; 検証=Task10。spec全節にタスク対応。
- **型整合:** `DfdNode/DfdFlow/DfdDiagram`(lib) と バックエンド出力(dfd.output) のキー名一致を実装時に確認（id/kind/label/number/refFlowId/refNodeId/positionX/positionY; sourceNodeId/targetNodeId/dataItem/reportTypeId/order）。エンドポイント名一致（business-flows/:flowId/dfd, projects/:projectId/dfd, dfd-nodes/:id, dfd-flows/:id, dfd-diagrams/:id/{nodes,flows,positions}, projects/:id/report-types, report-types/:id/attachments）。
- **第1レベル一意性:** Postgres UNIQUE は NULL 重複可 → generate/get は `findFirst({projectId,flowId:null})` の get-or-create で担保（Task3/6 に明記）。
- **テスト方針:** 純粋関数(assignFunctionNumbers/buildDataFlowRows)のみ vitest TDD、他は tsc + ライブ。
- **依存確認:** domain barrel のエクスポート名（BUSINESS_FLOW_REPOSITORY等）・FlowNodeLink の field 名・attachment.controller のアップロード実装は実装時に既存ファイルで確認して合わせる旨を各タスクに明記。
