# 業務イメージボード 領域フォルダ化＋全画面 ／ DFD 全画面 設計

作成日: 2026-06-17 / ブランチ: feat/methodology-pipeline / 承認済み

## 目的（ユーザー要望）
- 業務イメージボードを **ASIS/TOBE で分けず**、**領域（SubProject）でフォルダ分け**し、領域フォルダ内でボードを複数作れるようにする。
- 業務イメージボードのキャンバスを **全画面（フルスクリーン）に拡大**できるようにする。
- **DFD のキャンバスにも全画面表示**を付ける。

## 確定事項（AskUserQuestion）
- 「自由に拡大」=**フルスクリーン切替**（右上 ⧉ ボタン→画面全体、Esc/再クリックで復帰。Excalidraw のズームは従来どおり）。
- 担当者紐付け等とは無関係。kind(ASIS/TOBE) は**残すが UI では未使用**（後方互換。既存ボードは領域 null＝「未分類」に入る）。
- 領域フォルダ＝SubProject。領域未割当ボードは「未分類」グループ。
- DFD 全画面は frontend のみ（backend/スキーマ変更なし）。
- DB は `prisma db push`（additive）。
- 別途すでにコミット済みの3修正（業務一覧ポップオーバ portal 化・TOBE/GAP 常時表示・DFD 線変更の即時反映）も同じデプロイにまとめる。

---

## 1. 業務イメージボード — 領域フォルダ化

### データモデル（additive）
`ImageBoard` に `subProjectId String?` を追加（→ SubProject, onDelete: SetNull）。`SubProject` に逆リレーション `imageBoards ImageBoard[]`。`kind` は温存（UI 未使用）。`prisma db push`。

### バックエンド（`image-board.controller.ts`）
- `GET /api/projects/:projectId/image-boards`: **kind フィルタを廃止**し全ボード返却。一覧（軽量・scene 除外）に `subProjectId` を含める。
- `POST /api/projects/:projectId/image-boards`: body に `subProjectId?` を受ける（kind は任意・既定 ASIS 温存）。
- `PATCH /api/image-boards/:id`: `subProjectId?`（null でクリア＝未分類）を受ける＝ボードの領域移動。レスポンスに `subProjectId` 含める。

### フロント（`image-board/page.tsx` 改修 ＋ `lib/image-board.ts`）
- lib: `ImageBoardSummary`/`ImageBoardDto` に `subProjectId: string | null` 追加。`list` の kind 引数を廃止。`create(projectId, {title, subProjectId?})`。`update` patch に `subProjectId?`。
- page:
  - **KIND_TABS（ASIS/TOBE タブ）を撤去**。
  - 領域（SubProject）一覧を取得（`GET /api/projects/:id/sub-projects`、既存 `subProjectApi` or 直 fetch）。
  - 左のボード一覧を **領域フォルダ（折りたたみ）＋「未分類」** に再編。各フォルダ見出しに「＋ボード」（その `subProjectId` で作成、未分類は null）。ボード行＝タイトル選択／削除／**領域変更**（`SubProjectPicker` か select で `PATCH subProjectId`、未分類含む）。
  - 領域の入れ子（SubProject.parentId）は v1 ではフラット表示（親領域名でグルーピング、深い入れ子は名前パス表示で可）。

## 2. 業務イメージボード — 全画面（フルスクリーン）

`ExcalidrawBoard.tsx`（or page のキャンバスホスト）に全画面トグルを追加：
- ホストラッパに `isFullscreen` state。`true` で `fixed inset-0 z-50 bg-white`（画面全体）、`false` で従来の枠内。
- 右上に ⧉（Maximize2）/⧉解除（Minimize2）ボタン。Esc キー・ボタン再クリックで復帰（入力欄フォーカス中の Esc は無視）。
- Excalidraw 本体はラッパ 100% を満たすので、ラッパ拡大で自然に全画面化（Excalidraw 自身のズーム/スクロールは不変）。
- SwimlaneCanvas の全画面作法（Maximize2/Minimize2 + Esc + 再 fit）をミラー（Excalidraw は自動リフロー）。

> 配置上の注意: Excalidraw は別チャンク dynamic(ssr:false)。全画面 state は **ホスト（page or ExcalidrawBoard）側**で持ち、ラッパ className を切り替える。ExcalidrawBoard はキー（board.id）で remount されるため、全画面 state は**親(page)側**に置くのが安全（ボード切替で解除）。

## 3. DFD — 全画面

`DfdCanvas.tsx` に全画面トグルを追加（SwimlaneCanvas と同型）：
- `isFullscreen` state。`true` で `wrapperRef` のラッパが `fixed inset-0 z-50 w-screen h-screen`、`false` で従来。
- ツールバー/右上に ⧉ ボタン。Esc・再クリックで復帰（入力欄フォーカス中の Esc は無視）。
- DfdCanvas は自作 SVG（pan/zoom 内蔵）なので、ラッパ拡大で全画面化。全画面切替後にビューを収め直す（fitView 相当があれば呼ぶ、無ければそのまま）。
- backend/スキーマ変更なし。

## 4. 検証
- backend: `prisma validate`→`db push`、`nest build`、jest（image-board 一覧/作成/更新が subProjectId を扱う・kind フィルタ廃止の確認）。
- frontend: tsc 0、vitest、next build（image-board・dfd コンパイル）。
- ライブ smoke: 領域別ボード一覧、領域作成/移動（PATCH subProjectId）、業務イメージボード全画面トグル、DFD 全画面トグル。

## 5. スコープ外（YAGNI）
- ボードのドラッグ&ドロップで領域移動（v1 は select/picker で移動）。
- 領域フォルダの深い入れ子ツリー UI（v1 はフラット＋親名グルーピング、または名前パス）。
- kind(ASIS/TOBE) の完全削除（温存・UI 非表示）。
- Excalidraw のプレゼン/エクスポート追加（既存のまま）。

## リスク
- `image-boards` 一覧から kind フィルタを外すため、既存の kind 別ボードが全件混在表示になる（意図どおり＝領域フォルダで分類）。既存 ASIS/TOBE ボードは subProjectId=null で「未分類」に入る。
- 全画面 state を ExcalidrawBoard 内に置くと board 切替の remount で解除されてしまう → **親 page 側で保持**（spec 1.2 の注意）。
