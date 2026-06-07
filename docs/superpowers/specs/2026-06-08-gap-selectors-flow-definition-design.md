# GAP選択式化 ＋ 業務定義シート①/個別定義シート③ 設計

- 日付: 2026-06-08
- 対象: ai-data-flow（Next.js フロント + NestJS/Prisma バックエンド）
- 状態: 設計承認済み（ユーザレビュー前）

## 目的 / 背景

IPLoT方法論の「業務フロー」と「GAP（あるべき−現状）」をより正確・選択式に扱えるようにする。

1. **GAP追加を選択式に** — 対象業務・ASIS・TOBE を自由テキストではなく既存の業務フロー（とノード）から選ぶ。
2. **業務定義シート①（全業務一覧）** — 全業務フローを教材の「業務定義ツール_①業務定義シート.xlsx」の表形式で一覧化・編集。
3. **個別定義シート③（1フロー詳細）** — 1業務フローに対し「業務定義ツール_③個別定義シート.xlsx」のプロパティを全て編集。

**確定事項（ユーザ合意）**
- 「業務」の単位 = **1業務フロー**。①は全フローを1行ずつ並べた一覧、③はフローを開いた詳細編集。①と③は同じ「1フローの業務定義」データを共有（①=サマリ列、③=詳細列）。
- GAP追加: 対象業務=業務フロー選択、ASIS/TOBE=フロー選択（＋任意でフロー内ノード）、GAP内容はテキスト。

## データソース（教材Excel構造, /tmp/method-structures/asis.json より）
- 業務定義シート①: 1業務=1行の俯瞰表。列 = 目的 / 担当 / 関係者 / INPUT / トリガー / DO / OUTPUT / 頻度 / システム。
- 個別定義シート③: 1業務をA4 1枚に詳細化。INPUT(具体セル範囲) → トリガー → 番号付きDO手順 → OUTPUT → 次工程 → 例外処理 ＋ 暗黙知メモ。

## アーキテクチャ / データモデル

### Part 1: GAP選択式（スキーマ変更なし）
`GapItem` は既に以下を保持しているため**スキーマ変更不要**、フォームとAPI配線のみ:
- `businessArea`(string, 必須) … 対象業務名
- `asisFlowId` / `asisNodeId` / `tobeFlowId` / `tobeNodeId`(任意FK) … ASIS/TOBEのフロー・ノード
- `gapDescription`(text), `priority`, `ownerName`

挙動:
- フォームの「対象業務」= 業務フロー選択ドロップダウン → 選択フローの名前を `businessArea` に格納（既存値からの自由入力も許容）。
- 「ASIS」= `kind=ASIS` のフロー選択 → `asisFlowId`。選択後、そのフローのノード一覧を任意選択 → `asisNodeId`。
- 「TOBE」= `kind=TOBE` のフロー選択 → `tobeFlowId`（＋任意ノード `tobeNodeId`）。
- GAP一覧: ASIS/TOBEフロー名をチップ表示し、クリックで該当フロー（`/flows/{id}`、ノードがあればそれを選択状態）へ遷移。

### Part 2: 業務定義（フロー単位）= ①一覧 ＋ ③詳細（**採用案C: 専用 FlowDefinition モデル, 1:1**）
業務フローと **1:1** の専用モデル `FlowDefinition` を新設（型を厳密に）。`flowId @unique` で BusinessFlow に従属、フロー削除でカスケード。

```prisma
model FlowDefinition {
  id                String   @id @default(uuid())
  flowId            String   @unique @map("flow_id")
  purpose           String?  @db.Text   // 目的
  owner             String?              // 担当
  stakeholders      String?  @db.Text   // 関係者
  input             String?  @db.Text   // INPUT（概要 / ①表示）
  inputDetail       String?  @db.Text   // INPUT 具体（セル範囲等, ③）
  trigger           String?  @db.Text   // トリガー
  doSteps           Json     @default("[]")  // 番号付きDO手順（string[]）
  output            String?  @db.Text   // OUTPUT
  nextProcess       String?  @db.Text   // 次工程（③）
  exceptionHandling String?  @db.Text   // 例外処理（③）
  frequency         String?              // 頻度
  system            String?              // システム
  tacitNotes        String?  @db.Text   // 暗黙知メモ（③, 属人化リスク等）
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  flow BusinessFlow @relation(fields: [flowId], references: [id], onDelete: Cascade)
  @@map("flow_definitions")
}
```
- `BusinessFlow` に back-relation `definition FlowDefinition?` を追加。
- 番号付きDO手順は `doSteps Json`（string[]）。完全正規化（子テーブル）はYAGNIで採らない。

クリーンアーキの実装（案Cは実装量が多い点を許容済み, 参照 = flow-folder.* / sub-project.*）:
- domain: エンティティ `FlowDefinition`（private ctor + create/reconstruct + `update(props)` + touch()）、repo interface + `FLOW_DEFINITION_REPOSITORY` Symbol。
- infra: Prisma impl（flowId で upsert / find-by-flow / find-by-project の join）。
- use-case: `get-flow-definition`(by flowId), `upsert-flow-definition`(create-or-update), `list-flow-definitions`(by project, フロー基本情報と結合) — authz は flow→project→組織メンバー（全体管理者バイパス込み）。
- controller: `GET /api/business-flows/:flowId/definition`, `PUT /api/business-flows/:flowId/definition`（③）, `GET /api/projects/:projectId/flow-definitions`（①用; 各フローの基本情報 + definition を返す）。app.module に provider/controller 登録。

- **① 業務定義シート（プロジェクト全体）**: 専用ページ `/dashboard/projects/[projectId]/business-definition`。`GET /api/projects/:projectId/flow-definitions` で全フロー＋定義を取得し、1行ずつ表示。列 = 業務フロー名 / 目的 / 担当 / INPUT / DO / OUTPUT / 頻度 / システム。
  - 単純列（目的/担当/INPUT/OUTPUT/頻度/システム）はインライン編集 → `PUT .../:flowId/definition` で upsert 保存。
  - DO 列は `doSteps` を要約表示（「N手順」＋先頭手順）＋ 詳細編集は③へのリンク（行→`/flows/{id}` の個別定義タブ）。
  - サイドバー「現状把握」グループに導線「業務定義シート」を追加。
- **③ 個別定義シート（1フロー）**: `flows/[flowId]` のタブ「個別定義」で FlowDefinition 全項目を編集（`GET/PUT .../:flowId/definition`）。`doSteps` は番号付きの追加/削除/並べ替え可能なリスト、`exceptionHandling`/`tacitNotes`/`inputDetail` はテキストエリア。

### 既存との整合
- Phase B で追加した `flows/[flowId]` の「業務定義」タブ（RecordSheet `flow-definition:<flowId>`）は、本 `FlowDefinition` モデルベースの「個別定義」タブに**置き換え**る（型厳密＋一覧化のため）。RecordSheet版の既存データは実運用上ほぼ無いと想定し移行は行わない（必要なら別途）。
- 「情報の地図(CRUOA)」タブは現状維持。

## コンポーネント / データフロー
- フロント:
  - `gap-items/page.tsx`: 作成/編集フォームに 対象業務(flowセレクト) / ASIS(flow+node) / TOBE(flow+node) を追加。`business-flows/project/:id/all` でフロー一覧取得、選択フローのノードは `business-flows/:id` から取得。一覧行に ASIS/TOBE チップ。
  - `business-definition/page.tsx`（新規）: `GET /api/projects/:projectId/flow-definitions` で全フロー＋定義 → 表。行編集 → `PUT /api/business-flows/:flowId/definition`。
  - `flows/[flowId]/page.tsx`: 「個別定義」タブを FlowDefinition 編集UIに（`GET/PUT .../:flowId/definition`、DO手順リスト等）。
  - `layout.tsx`: 現状把握グループに「業務定義シート」追加。
- バックエンド: 専用 `FlowDefinition` クリーンアーキスライス（entity / repo interface + `FLOW_DEFINITION_REPOSITORY` / Prisma impl / use-cases get・upsert・list-by-project / controller の3エンドポイント）。`BusinessFlow` には back-relation `definition` を追加するのみ（business-flow.controller の create/update は変更不要）。app.module 配線。

## エラー処理
- definition 未設定フローは空オブジェクト扱い（①では空欄表示）。
- GAPのフロー/ノードFKは onDelete: SetNull（既存）。フロー削除時はGAPの参照がnullになるだけ。
- 権限は既存の project→組織メンバー（全体管理者バイパス込み）認可を踏襲。

## テスト / 検証
- `prisma validate` / `generate` / `db push`（postgres :5460）。
- backend tsc 0 / frontend tsc 0 / vitest（既存68維持、必要なら definition 整形のpure関数にテスト追加）。
- ライブ疎通: GAP作成でflow/node選択→保存→一覧チップ表示; 業務定義シート①の一覧表示・行編集保存; 個別定義③の全項目編集保存。

## スコープ外（YAGNI）
- GAPノードの厳密な差分自動算出（ASISノード↔TOBEノードの自動マッチング）。
- 業務定義のバージョン管理・履歴。
- RecordSheet版業務定義データの自動マイグレーション。
