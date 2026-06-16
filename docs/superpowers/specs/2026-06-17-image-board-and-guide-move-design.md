# 業務イメージ（スライド）ボード ＋ ガイド トップレベル移動 設計

作成日: 2026-06-17 / ブランチ: feat/methodology-pipeline / 承認済み

## 確定事項
- ボードのキャンバス = **自作SVG（ObjectMapCanvas パターン流用）**（新規依存ゼロ・UI統一）。
- **矢印・Backspace削除・undo/redo履歴は v1 に含める**（DFD/object-map の作法＋既存 `use-flow-undo-redo` を流用）。設計時の「後送り」案は上書き。
- ASIS/TOBE = `ImageBoard.kind` 別ボード（一覧タブ切替、1枚両方は2ゾーンスターター）。
- 画像=既存共有プール流用、アイコン=lucide 業務サブセット、エクスポート=PNG（html-to-image）、サイドバー=「現状把握」グループ。
- **ガイド（汎用マニュアル）はトップレベル `/dashboard/guide` へ移動**（プロジェクトURL配下から外す）。
- DB は `prisma db push`（additive・migration ファイル不要）。

---

## 1. 業務イメージボード

### 目的
画像＋アイコン＋テキスト＋図形＋矢印を自由配置して ASIS/TOBE の業務の流れを「1枚のスライド」でラフに描く補完ツール（構造化図 DFD/swimlane/object-map の手前）。

### データモデル（additive・新2モデル）
```prisma
enum ImageBoardKind { ASIS TOBE }
enum ImageBoardElementType { IMAGE ICON TEXT SHAPE ARROW }

model ImageBoard {
  id String @id @default(uuid())
  projectId String @map("project_id")
  kind ImageBoardKind @default(ASIS)
  title String @default("")
  order Int @default(0)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  elements ImageBoardElement[]
  @@index([projectId]) @@map("image_boards")
}
model ImageBoardElement {
  id String @id @default(uuid())
  boardId String @map("board_id")
  type ImageBoardElementType @default(TEXT)
  positionX Float @default(0) @map("position_x")
  positionY Float @default(0) @map("position_y")
  width Float? @map("width")
  height Float? @map("height")
  rotation Float @default(0)        // v1は0固定運用可（UIは後で）
  z Int @default(0)
  attachmentId String? @map("attachment_id")  // IMAGE
  icon String?                                 // ICON: lucide名
  text String @default("") @db.Text            // TEXT
  shape String?                                // SHAPE: rect|roundRect|ellipse
  points Json?                                 // ARROW: [{x,y},{x,y}]
  startRef String? @map("start_ref")           // ARROW端点スナップ（任意・v1未使用可）
  endRef String? @map("end_ref")
  arrowStyle String? @map("arrow_style")       // single|double|line
  color String?
  fillOpacity Float? @map("fill_opacity")
  borderStyle String? @map("border_style")
  fontSize Float? @map("font_size")
  style Json?
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  board ImageBoard @relation(fields: [boardId], references: [id], onDelete: Cascade)
  attachment Attachment? @relation(fields: [attachmentId], references: [id], onDelete: SetNull)
  @@index([boardId]) @@map("image_board_elements")
}
```
`Project` に `imageBoards ImageBoard[]`、`Attachment` に `imageBoardElements ImageBoardElement[]` 逆リレーション追加（additive）。

### API（CRUOA/annotation の thin controller 流儀。フルclean-arch不要）
- `GET/POST /api/projects/:projectId/image-boards`（一覧[kindフィルタ]／作成[kind,title、任意で2ゾーンスターター]）
- `GET /api/image-boards/:id`（{board, elements}）
- `PATCH/DELETE /api/image-boards/:id`（title/kind/order・削除）
- 要素: `POST /api/image-boards/:boardId/elements`／`PATCH /api/image-board-elements/:id`（移動/リサイズ/編集は要素PATCH楽観更新）／`DELETE /api/image-board-elements/:id`。
- :id 系は board→projectId をロードして既存 ProjectAccess を assert（object-map annotation/overview-matrix と同型）。

### フロント
- `lib/image-board.ts`（API＋DTO型、`data-objects.ts` 形を参考）。
- `image-board/page.tsx`（ボード一覧＋ASIS/TOBEタブ＋本体ホスト）。
- `_components/ImageBoardCanvas.tsx`（**自作SVG本体**: ObjectMapCanvas の ViewTransform/screenToWorld/ドラッグ状態機械/foreignObject編集/リサイズハンドルを移植。要素描画 IMAGE=`<image>`／ICON=`<foreignObject>`+lucide／TEXT=`<foreignObject>`+textarea／SHAPE=`<rect>/<ellipse>`／ARROW=`<path>`+marker。pan/zoom/fitView、ドラッグ移動、8方向リサイズ、選択、**Backspace削除（DFD作法: window keydown→onDelete、入力中無視）**、**矢印（端点2ハンドルドラッグ or ハンドル接続）**、**undo/redo（use-flow-undo-redo をボード要素スナップショットに適応 or 同等の履歴フック）**）。
- `_components/ElementInspector.tsx`（右パネル: x/y/幅/高/z/色/不透明度/枠線/フォントサイズ/削除）。
- `_components/ImagePickerDialog.tsx`（`projectAttachmentApi` で kind=IMAGE 共有プール一覧＋`uploadProjectFile` 新規アップロード）。
- `_components/IconPalette.tsx`（lucide 業務サブセット: User/Users/Building2/Server/Database/Cpu/Cloud/Network/FileText/FileSpreadsheet/ClipboardList/Mail/Receipt/ArrowRight/RefreshCw/Check/AlertTriangle/Clock/Target/Lightbulb 等、name→component マップ＋検索）。
- エクスポート: `html-to-image` toPng()（SwimlaneCanvas と同じ）。
- サイドバー: `layout.tsx` projectGroups「現状把握」に `{ name:'業務イメージボード', href:`${base}/image-board`, icon: Presentation }`。

### v1スコープ
入れる: ボードCRUD(kind/title・タブ)、要素5種(IMAGE/ICON/TEXT/SHAPE/ARROW)、pan/zoom/fitView/ドラッグ/リサイズ/選択/インスペクタ、**Backspace削除・矢印・undo/redo**、画像(共有プール選択＋アップロード)、アイコンパレット、PNGエクスポート、2ゾーンスターター。
入れない: 端点の要素自動追従スナップ(startRef/endRefは枠だけ用意)、回転UI(rotation列は用意・0運用)、複数選択、整列ガイド、AI自動ドラフト、PPTX/SVG、共同編集、SHAPEメンバーシップ追従。

### リスク
PNGエクスポートは画像CORS依存(既存 SwimlaneCanvas で実績) / 矢印端点スナップ後付け時に world座標追従ロジックが要る(startRef/endRef を先に用意して後方互換) / 自作キャンバスは undo/redo・多重選択を自作(undoは既存フック流用で低減)。

---

## 2. ガイドのトップレベル移動
- 現状: `/dashboard/projects/[projectId]/guide`（汎用 `MANUAL_ENTRIES` を表示、`projectId` は主に各機能ページへのディープリンク用）。サイドバーは `guideNav`（プロジェクト選択時のみ最上部）。
- 変更: **トップレベル `/dashboard/guide/page.tsx` を新設**（projectId 非依存で `MANUAL_ENTRIES` を表示）。プロジェクト機能への**ディープリンクはプロジェクト未選択時は href を出さない（機能名表示のみ）か「プロジェクトを開く」誘導**にして graceful degrade。
- サイドバー: `baseNav`（ダッシュボード/プロジェクト付近）に `{ name:'ガイド', href:'/dashboard/guide', icon: Compass }` を追加。**プロジェクト配下の `guideNav`（最上部）は撤去**し、旧 `projects/[projectId]/guide/page.tsx` は削除（ルート消滅）。
- 既存 `dashboard/` 直下には batches/companies/settings 等のトップレベルページが既にあり、`dashboard/guide` 追加は同型。

## 検証
backend: prisma generate→nest build→jest。frontend: tsc 0 / vitest / next build（/image-board・/image-board host・/dashboard/guide compiled、旧 project guide 消滅）。本番: 新2テーブルは additive→db push。
