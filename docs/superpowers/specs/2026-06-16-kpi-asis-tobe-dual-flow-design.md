# KPI に ASIS / TOBE 業務フローを両方紐づける 設計

作成日: 2026-06-16 / ブランチ: feat/methodology-pipeline / 承認済み

## 背景・確定事項
- 現状 `Kpi.flowId`（単一・任意）。ユーザー要望: **1つのKPIに ASIS フローと TOBE フローを両方同時に紐づけたい**。
- 方針: `asisFlowId` + `tobeFlowId` を**追加（additive・非破壊）**。既存 `flowId` は残す（後方互換・生成の「元フロー」用）。UIのフロー選択は「ASIS業務フロー」「TOBE業務フロー」の2つに。生成時は元フローの kind に応じて asis/tobe へ自動リンク（flowId も従来どおり設定）。
- DB は `prisma db push`（additive 列追加・migration ファイル不要）。

## バックエンド
### schema.prisma `model Kpi`
- 追加: `asisFlowId String? @map("asis_flow_id")` / `tobeFlowId String? @map("tobe_flow_id")`。
- リレーション（同一 BusinessFlow への複数リレーションになるため**名前付き**が必須）:
  - 既存 `flow` を `@relation("KpiFlow", ...)` に命名（既存の暗黙名を明示名へ）。
  - `asisFlow BusinessFlow? @relation("KpiAsisFlow", fields:[asisFlowId], references:[id], onDelete: SetNull)`
  - `tobeFlow BusinessFlow? @relation("KpiTobeFlow", fields:[tobeFlowId], references:[id], onDelete: SetNull)`
- `model BusinessFlow` 側に対応する back-relation を追加（既存 `kpis Kpi[]` があれば `@relation("KpiFlow")` を付与し、`kpisAsis Kpi[] @relation("KpiAsisFlow")` / `kpisTobe Kpi[] @relation("KpiTobeFlow")` を追加）。※既存の Kpi↔BusinessFlow back-relation の有無を確認し、命名衝突なく追加すること。
- `npx prisma generate`。

### DTO / use-case / output（`kpi.controller.ts` / `application/use-cases/kpi/*`）
- Create/Update DTO に `asisFlowId?: string | null` / `tobeFlowId?: string | null` を追加（`@IsOptional() @IsString()`）。
- create/update use-case で永続化（`?? null`）。
- `kpi.output.ts` に `asisFlowId` / `tobeFlowId` を含める。表示用に `asisFlowName` / `tobeFlowName`（任意。include で解決 or 既存の flow 解決方式に合わせる）も返せると望ましい（最小は id のみでも可、フロントは masters から名前解決可能）。

## フロントエンド
### lib/kpis.ts 型
- `KpiDto` に `asisFlowId: string | null` / `tobeFlowId: string | null`（+ あれば name）を追加。create/update ペイロード型にも追加。

### KpiEditModal（`ai-create/_components/kpi-edit-modal.tsx`）
- 既存の単一「対象業務フロー」`<select>` を、**2つの選択**に置換:
  - 「ASIS業務フロー」= flows を `kind==='ASIS'` で絞った select（`asisFlowId` にバインド、空=指定なし可）。
  - 「TOBE業務フロー」= `kind==='TOBE'` で絞った select（`tobeFlowId`）。
- 保存時 `asisFlowId`/`tobeFlowId` を送る。`flowId` はモーダルからは編集しない（既存値は保持）。

### 生成タブ（business-kpi-tab / ai-quality-tab）
- 生成元フロー選択は現状どおり（FlowSelect で1つ）。生成リクエスト or 生成後の保存で、その元フローの kind が ASIS→`asisFlowId`、TOBE→`tobeFlowId` に入るようにする（flowId も従来どおり）。最小実装: 生成 use-case が flow.kind を見て該当列へセット。難しければフロント側で生成後に補完、もしくは「生成KPIは手動編集で ASIS/TOBE を確定」でも可（その場合はモーダルで紐づけ）。
- ※ai-quality（AI精度指標）は主にシステム対象なのでフロー紐づけは任意。両フロー選択は主に業務KPIで有効。

### 表示（KpiCard / kpi-format）
- KPI カード/行に、紐づく ASIS フロー名・TOBE フロー名を併記（両方ある場合は両方、片方のみなら片方）。masters（flows）から id→name 解決、または output の name を使用。

## 検証
backend: `prisma generate` → nest build → jest（既存緑）。frontend: tsc 0 / vitest / next build。本番: 追加2列は additive → build の db push で in-sync（--accept-data-loss 不要）。

## スコープ外
flowId の撤廃/バックフィル（後方互換で残す）。多対多（ASIS/TOBE 各1つで十分）。AI精度指標の必須フロー化。
