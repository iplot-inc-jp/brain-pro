# 俯瞰思考（俯瞰資料図ビルダー）設計

作成日: 2026-06-16 / ブランチ: feat/methodology-pipeline / 承認済み

## 確定事項
- 汎用 **N軸**マトリクスビルダー（**v1は最大3軸**）。既存 CRUD表/CRUOA/RACI は**置換せず併存**。
- **新スキーマ追加（additive）**。**軸項目は v1 は自由入力のみ**（sourceType/sourceId はモデルに用意するが配線は後続）。
- 3軸は**セル結合**（rowspan/colspan）で2D表現。非対称/非該当領域は**グレーアウト**（per-cell `isApplicable`＋`reason`、行/列見出しの一括トグルは各セルへ展開保存）。
- セル値モードは表ごと `cellMode`(TEXT/TAGS/SYMBOL)。保存は CRUOA と同じ **replace-all（$transaction 全置換）**。プロジェクト単位。**DB は `prisma db push`（migration ファイル作らない）**。

## ルート
- 一覧 `/dashboard/projects/[projectId]/overview-matrix`
- 編集 `/dashboard/projects/[projectId]/overview-matrix/[matrixId]`

## データモデル（schema.prisma に追加。Project に `overviewMatrices OverviewMatrix[]` 追加）
```prisma
model OverviewMatrix {
  id String @id @default(uuid())
  projectId String @map("project_id")
  name String
  purpose String? @db.Text
  cellMode String @default("TEXT")        // TEXT | TAGS | SYMBOL
  tagOptions Json? @map("tag_options")    // [{key,label,color}]（TAGS/SYMBOL用）
  order Int @default(0)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  axes OverviewMatrixAxis[]
  cells OverviewMatrixCell[]
  @@index([projectId])
  @@map("overview_matrices")
}
model OverviewMatrixAxis {
  id String @id @default(uuid())
  matrixId String @map("matrix_id")
  axisIndex Int @map("axis_index")        // 0=行,1=列,2=第3軸
  name String
  side String @default("COL")             // 'ROW' | 'COL'（第3軸の結合方向）
  createdAt DateTime @default(now()) @map("created_at")
  matrix OverviewMatrix @relation(fields: [matrixId], references: [id], onDelete: Cascade)
  items OverviewMatrixAxisItem[]
  @@unique([matrixId, axisIndex])
  @@index([matrixId])
  @@map("overview_matrix_axes")
}
model OverviewMatrixAxisItem {
  id String @id @default(uuid())
  axisId String @map("axis_id")
  label String
  order Int @default(0)
  sourceType String @default("FREE") @map("source_type")  // FREE|ROLE|DATA_OBJECT|TABLE|SYSTEM|STATUS
  sourceId String? @map("source_id")
  createdAt DateTime @default(now()) @map("created_at")
  axis OverviewMatrixAxis @relation(fields: [axisId], references: [id], onDelete: Cascade)
  @@index([axisId])
  @@map("overview_matrix_axis_items")
}
model OverviewMatrixCell {
  id String @id @default(uuid())
  matrixId String @map("matrix_id")
  rowItemId String @map("row_item_id")
  colItemId String @map("col_item_id")
  layerItemId String? @map("layer_item_id")   // 第3軸（2軸時null）
  value String? @db.Text                       // TEXT本文 / "C/R/U" / 記号
  note String? @db.Text
  isApplicable Boolean @default(true) @map("is_applicable")
  reason String?
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  matrix OverviewMatrix @relation(fields: [matrixId], references: [id], onDelete: Cascade)
  @@unique([matrixId, rowItemId, colItemId, layerItemId])
  @@index([matrixId])
  @@map("overview_matrix_cells")
}
```
セルは軸**項目id**でキー（ラベル改名で孤児化しない）。replace-all 保存で項目消滅セルを掃除（CRUOA と同規律）。`@@unique` の layerItemId=NULL 重複防止はアプリ層(replace-all)で担保。

## API（CRUOA controller 踏襲・thin controller + replace-all、フルclean-arch不使用）
- `GET /api/projects/:projectId/overview-matrices` 一覧
- `POST /api/projects/:projectId/overview-matrices` 新規（name/purpose、2軸ひな形を生成）
- `GET /api/overview-matrices/:matrixId` → `{matrix, axes:[{...,items:[]}], cells:[]}`
- `PUT /api/overview-matrices/:matrixId` axes+items+cells を $transaction で全置換
- `PATCH /api/overview-matrices/:matrixId`（name/purpose/cellMode/tagOptions）・`DELETE`
プロジェクトアクセスは既存 ProjectAccessGuard/assertProjectAccess を CRUOA と同様に適用。

## フロント
- `lib/overview-matrix.ts`（cruoa.ts を雛形に API ヘルパ）。
- `lib/overview-matrix-layout.ts` の純関数 **`buildMatrixLayout(axes, cells)` → `{ headerRows, bodyRows, cellAt(row,col,layer) }`** ＋ `lib/overview-matrix-layout.test.ts`（2軸/3軸COL/3軸ROW、colSpan/rowSpan、グレーアウト、空軸エッジ）。flow-layout と同じ pure+tested 方針。
- 一覧 page：カード一覧（名前/目的/軸数/更新）＋新規作成（→2軸空マトリクス生成→編集へ）＋複製/削除。
- 編集 page ＋ `_components/OverviewMatrixEditor.tsx`：(A)ツールバー（表名/目的インライン編集・cellMode切替・軸追加/削除[2〜3]・保存[dirty]・CSV/印刷）(B)軸定義パネル（軸名＋項目 追加/編集/削除/↑↓並べ替え）(C)マトリクス表（3軸は列見出し2段 colSpan/rowSpan、セルは mode 別入力、グレーアウトはセル右クリック/見出し⊘・灰背景＋「─」＋reason、value空×applicableは「?」）(D)空白セル監査（未定数・非該当数）。CRUOA のツールバー/dirty保存/トグルチップ/診断パターンを移植（直接共用はしない）。`useReadOnly()` で編集ゲート。
- 第3軸 rowspan/colspan：side='COL'=列見出し2段（1段目 列軸を colSpan=第3軸項目数、2段目 第3軸項目）。side='ROW'=行見出し2列で第3軸を rowSpan。2軸は layerItemId=null 単純グリッド。
- エクスポート：CSV（catalog の Blob+createObjectURL 方式、3軸は見出し2行展開・グレーは「─」・未定は空欄）＋ `window.print()`。
- サイドバー：`layout.tsx` の「設計」グループ CRUD表 直後に `{ name:'俯瞰思考', href:`${base}/overview-matrix`, icon: TableProperties }`。

## スコープ外（v1）
4軸以降・無限ネスト・マスタ自動取込・ルールベース自動グレーアウト・バージョン履歴・AI自動生成・Excel/画像エクスポート・既存マトリクス統合/移行・ドラッグ並べ替え。

## 検証
backend: `npx prisma generate` 後 nest build + jest（replace-all ラウンドトリップ/孤児セル掃除）。frontend: buildMatrixLayout の vitest（2軸/3軸両方向/グレーアウト）＋ tsc + next build（両ルート compiled）。本番: 純 additive 新テーブルなので build の `db push` で in-sync。

## リスク
replace-all は大表で全削除→全作成（3軸直積でセル爆発→createMany バッチ/トランザクション時間注意）/ rowspan+sticky+横スクロールの CSS は実機確認 / layerItemId=NULL の UNIQUE はアプリ層担保 / リージョン一括グレーアウト後に項目追加すると新セルが applicable=true（再適用導線）/ side ROW/COL 双方向のレイアウト分岐テスト網羅 / 既存マトリクスとの棲み分け説明。
