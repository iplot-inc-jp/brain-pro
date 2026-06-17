# 業務フロー/DFD/オブジェクト関係 ― 画像D&D配置 ＋ ノード添付(動画/PDF/画像) ＋ ナレッジグラフ連携 設計

作成日: 2026-06-17 / ブランチ: feat/methodology-pipeline / ステータス: レビュー待ち

## 確定事項（ブレスト結果）
- **データモデル方針 = A（統一ポリモーフィック）**。3図(業務フロー/DFD/オブジェクト関係)に対し、図要素は単一 `DiagramElement`（`diagramKind+diagramId` でスコープ）、ノード添付は単一 `NodeAttachment` 結合（`nodeKind+nodeId`）で一本化。バックエンド・コントローラ・フロント要素コンポーネントを各1本に。既存 `ImageBoardElement` のフィールド形をそのまま流用。
- **対象 = 3図すべて**。業務フロー(`SwimlaneCanvas`)・DFD(`DfdCanvas`)は React Flow、オブジェクト関係マップ(`ObjectMapCanvas`, 自作SVG・`DataObject`が節点)はハンドロール。※table-level ER(`ErCanvas`, `Table`が節点)は別物で v1 対象外。
- **KG連携 = 常時登録 ＋ AIはオンデマンド**。ノード添付は無課金で自動的に `KnowledgeDocument`(sourceType=ATTACHMENT) 化＋エンティティ紐付け。Claude抽出は「AI抽出」ボタン押下時のみ（既存 `aiExtractionEnabled` ガード）。
- **動画 = 簡易再生(≤100MB)**。`<video>` インライン再生。ストリーミング/トランスコードは v1 対象外。
- **オブジェクト関係のノード = `DataObject`（オブジェクトの箱）**。Table/Column 添付は v1 対象外（`NodeAttachment` は将来拡張できる形にしておく）。
- DB は `prisma db push`（additive・migration ファイル不要）。既存の `ImageBoard` は v1 では触らない（mid-build・フロント未実装）。将来 `DiagramElement` への統合は v1 非スコープ。

> 2つの機能を、共通の保存基盤（既存 `Attachment` + Vercel Blob + `uploadProjectFile()`）の上に載せる。新規ストレージは作らない。
> - **機能① 画像D&D配置**: キャンバスに画像をドロップ→アップロード→`DiagramElement{IMAGE}` を配置（移動/リサイズ可・装飾的フリー要素）。
> - **機能② ノード添付**: ノードをクリック→インスペクタで動画/PDF/画像を添付・閲覧（意味的・`NodeAttachment`）。
> - **機能③ KG連携**: ②は自動で KG 文書化＋エンティティ紐付け、①は手動で「KGに追加」。

---

## 1. データモデル（additive・新3モデル＋3 enum）

```prisma
enum DiagramKind { FLOW DFD OBJECT_MAP }      // OBJECT_MAP = オブジェクト関係マップ(DataObjectが節点・ObjectMapCanvas)
enum DiagramElementType { IMAGE ICON TEXT SHAPE ARROW } // ImageBoardElementType をミラー。v1出荷は IMAGE のみ
enum DiagramNodeKind { FLOW_NODE DFD_NODE DATA_OBJECT }

// 機能①: 3図共通の装飾フリー要素（移動/リサイズ可な画像など）
model DiagramElement {
  id          String             @id @default(uuid())
  projectId   String             @map("project_id")   // アクセス制御＋スコープ用
  diagramKind DiagramKind        @map("diagram_kind")
  diagramId   String             @map("diagram_id")   // FLOW=BusinessFlow.id / DFD=DfdDiagram.id / OBJECT_MAP=projectId
  type        DiagramElementType @default(IMAGE)
  positionX   Float              @default(0) @map("position_x")
  positionY   Float              @default(0) @map("position_y")
  width       Float?
  height      Float?
  rotation    Float              @default(0)          // 列は用意・v1は0運用（ImageBoard同方針）
  z           Int                @default(0)
  attachmentId String?           @map("attachment_id") // IMAGE
  text        String             @default("") @db.Text // 将来 TEXT 用
  color       String?
  style       Json?
  createdAt   DateTime           @default(now()) @map("created_at")
  updatedAt   DateTime           @updatedAt @map("updated_at")
  project    Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  attachment Attachment? @relation(fields: [attachmentId], references: [id], onDelete: SetNull)
  @@index([projectId])
  @@index([diagramKind, diagramId])
  @@map("diagram_elements")
}

// 機能②: 3図のノードへの添付（多対多・ノード側はポリモーフィック）
model NodeAttachment {
  id           String          @id @default(uuid())
  projectId    String          @map("project_id")
  nodeKind     DiagramNodeKind @map("node_kind")
  nodeId       String          @map("node_id")        // FlowNode.id / DfdNode.id / DataObject.id（ポリモーフィック=FKなし）
  attachmentId String          @map("attachment_id")
  order        Int             @default(0)
  caption      String?
  createdAt    DateTime        @default(now()) @map("created_at")
  project    Project    @relation(fields: [projectId], references: [id], onDelete: Cascade)
  attachment Attachment @relation(fields: [attachmentId], references: [id], onDelete: Cascade)
  @@unique([nodeKind, nodeId, attachmentId])
  @@index([projectId])
  @@index([nodeKind, nodeId])
  @@map("node_attachments")
}

// 機能③: KGエンティティ ⟷ 図ノード の橋渡し（net-new プリミティブ）
model KnowledgeNodeLink {
  id              String          @id @default(cuid())
  projectId       String
  knowledgeNodeId String
  diagramKind     DiagramKind                          // FLOW/DFD/OBJECT_MAP
  diagramNodeId   String                               // FlowNode.id / DfdNode.id / DataObject.id（FKなし）
  createdAt       DateTime        @default(now())
  knowledgeNode KnowledgeNode @relation(fields: [knowledgeNodeId], references: [id], onDelete: Cascade)
  @@unique([knowledgeNodeId, diagramKind, diagramNodeId])
  @@index([projectId])
  @@index([diagramKind, diagramNodeId])
}
```

逆リレーション（additive）: `Attachment` に `diagramElements DiagramElement[]` / `nodeAttachments NodeAttachment[]`、`Project` に `diagramElements` / `nodeAttachments` / `knowledgeNodeLinks`、`KnowledgeNode` に `diagramLinks KnowledgeNodeLink[]`。

**ポリモーフィックの帰結**: `NodeAttachment.nodeId`・`KnowledgeNodeLink.diagramNodeId`・`DiagramElement.diagramId(OBJECT_MAP=projectId)` は図ノード表への DB-FK を張れない。→ ノード削除時に孤児行が残るため、各ノード削除サービス（Flow/DFD/DataObject の delete）に「該当 `nodeKind/nodeId` の `NodeAttachment`・`KnowledgeNodeLink` を掃除」フックを追加する（またはread時に存在しないノードを遅延フィルタ）。

---

## 2. KGへの取り込み（常時登録＋AIオンデマンド）

ノードにファイルを添付したとき（無課金・決定的処理）:
1. `Attachment` 作成（既存アップロード経路）→ `NodeAttachment` 行作成。
2. **エンティティ確保**: そのノードに対応する `KnowledgeNode` を find-or-create（`type=ENTITY`, `normalizedLabel = normalize(node.label/name)`、既存 `@@unique([projectId,type,normalizedLabel])` で名寄せ）。
3. **橋渡し**: `KnowledgeNodeLink(knowledgeNode ⟷ nodeKind:nodeId)` を ensure。
4. **文書化**: `KnowledgeDocument(sourceType=ATTACHMENT, sourceRef=attachmentId, blobUrl, mimeType, title=displayName/filename)` を作成。
5. **言及**: `KnowledgeMention(document ⟷ knowledgeNode)` を作成。
   → 結果: KG上でそのノードがエンティティ化し、添付メディアが文書として“そのノードに紐づく”。同一エンティティが flow/DFD/object-map 横断で `KnowledgeNodeLink` を複数持てる（=「このエンティティはこれらの図に登場し、これらのメディアを持つ」が成立）。

オンデマンド「AI抽出」ボタン:
- 対象 `KnowledgeDocument` の本文（PDF/画像はまずテキスト抽出）に対し Claude 抽出を実行し、追加の `KnowledgeNode`/`KnowledgeRelation`/`KnowledgeMention` を生成。
- 既存 `aiExtractionEnabled` ＋課金ガードに従う（[[knowledge-graph-ingestion]] のバッチ抽出を1文書版で再利用）。

機能①の装飾画像（`DiagramElement`）: 既定では **KG自動化しない**。要素メニューの「KGに追加」押下時のみ `KnowledgeDocument(sourceType=ATTACHMENT)` 化（ノード紐付けなしの素の文書）。装飾画像のエンティティ自動紐付けは v1 対象外。

---

## 3. バックエンド（thin controller 流儀。image-board/annotation と同型・フルclean-arch不要）

- `DiagramElementController`
  - `GET  /api/projects/:projectId/diagram-elements?diagramKind=&diagramId=` 一覧
  - `POST /api/projects/:projectId/diagram-elements`（{diagramKind, diagramId, type, x, y, w, h, attachmentId}）
  - `PATCH /api/diagram-elements/:id`（移動/リサイズ/z/色 ― 楽観更新）
  - `DELETE /api/diagram-elements/:id`
- `NodeAttachmentController`
  - `GET  /api/projects/:projectId/node-attachments?nodeKind=&nodeId=` 一覧（attachment 埋め込み）
  - `POST /api/projects/:projectId/node-attachments`（{nodeKind, nodeId, attachmentId}）← ここで §2 の KG 常時登録を発火
  - `PATCH /api/node-attachments/:id`（order/caption）
  - `DELETE /api/node-attachments/:id`（対応 `KnowledgeMention`/孤児 doc も整理）
- KG橋渡しサービス（既存 knowledge モジュール内）
  - `ensureEntityForNode(projectId, nodeKind, nodeId, label)` → `{ knowledgeNodeId }`
  - `registerAttachmentDocument(projectId, attachmentId, linkNodeId?)` → `KnowledgeDocument`(+Mention)
  - `POST /api/knowledge/documents/:id/extract`（オンデマンドAI抽出。aiExtractionEnabledガード）
- `:id` 系は親 → `projectId` をロードして既存 `ProjectAccess` を assert（object-map annotation/overview-matrix/image-board と同型）。
- アップロードは既存経路を再利用: `POST /projects/:projectId/blob/upload-token` →（client `upload()`）→ `register-blob`（≤100MB）。`uploadProjectFile()` でアップロード後、`POST node-attachments` / `POST diagram-elements` で結合行を作る（アップロードと結合を分離）。

---

## 4. フロント

共通ライブラリ:
- `lib/diagram-elements.ts`（API＋DTO型、`data-objects.ts` 形）
- `lib/node-attachments.ts`（同上）
- 既存 `lib/upload.ts` `uploadProjectFile()`／`components/ui/file-drop-zone.tsx` `FileDropZone` を流用。

機能①（画像D&D・移動/リサイズ）:
- **業務フロー/DFD（React Flow）**: ラッパに `onDrop`/`onDragOver` を追加し、ドロップ座標を `screenToFlowPosition()` で変換→`uploadProjectFile`→`POST diagram-elements`→`nodeTypes` に新カスタムノード `imageElement` を追加して描画。移動は `onNodeDragStop`、リサイズは React Flow `NodeResizer`。永続化は `PATCH diagram-elements/:id`。
- **オブジェクト関係マップ（自作SVG `ObjectMapCanvas`）**: 既存 ViewTransform/screenToWorld でドロップ座標変換→アップロード→`<image>` 要素描画＋ドラッグ移動＋8方向リサイズハンドル＋z。永続化は既存 `DataObject.positionX/Y`（ObjectMapCanvas のデバウンス一括保存）に倣う（**最大工数箇所**）。

機能②（ノード添付・閲覧）:
- `_components/NodeInspectorPanel.tsx`（3図共通。`(nodeKind, nodeId, label)` を渡すアダプタで各キャンバスから開く）
  - **添付タブ**: `FileDropZone` でアップロード＋一覧（サムネ）＋順序/キャプション/削除。インライン閲覧 ― 画像=`<img>`、動画=`<video controls>`（`GET /api/attachments/:id/file`）、PDF=既存配信（`?pageRange` 対応の iframe / pdf ビューア）。
  - **ナレッジグラフタブ**: このノードの KG エンティティ状態（リンク有無）、紐づく文書一覧、「AI抽出」ボタン、KGビューへのリンク。
- ノードクリック→パネルを開く: 業務フロー/DFD は React Flow の選択イベント、object-map は `DataObject` クリックにフック。

---

## 5. v1 スコープ

**入れる**:
- 3キャンバスへ画像ドロップ→移動/リサイズ可の `DiagramElement{IMAGE}`（Flow/DFD=React Flow カスタムノード＋NodeResizer、object-map=自作SVG `ObjectMapCanvas`）。
- ノードクリック→`NodeInspectorPanel` 添付タブ: 動画(≤100MB)/PDF/画像のアップロード・一覧・インライン閲覧・順序/キャプション/削除（`nodeKind` = FLOW_NODE/DFD_NODE/DATA_OBJECT）。
- KG: 添付の常時自動登録（`KnowledgeDocument` ＋ ノードのエンティティ確保 ＋ `KnowledgeMention` ＋ `KnowledgeNodeLink` 橋渡し）。「AI抽出」オンデマンド（`aiExtractionEnabled` ガード）。
- ノード削除時の孤児（`NodeAttachment`/`KnowledgeNodeLink`）掃除フック。

**入れない（v1非スコープ）**:
- table-level ER(`ErCanvas`, Table/Column) の画像配置・添付（v1 は object-map の `DataObject` のみ）。
- 装飾画像の KG 自動紐付け（手動「KGに追加」のみ）。
- 動画のストリーミング/トランスコード/>100MB。
- `DiagramElement` の TEXT/SHAPE/ARROW 描画（フリー作図は `ImageBoard` を使用。enum は将来用にミラーのみ）。
- 標準 `ImageBoard` の `DiagramElement` への統合（将来クリーンアップ）。
- 回転UI（`rotation` 列は用意・0運用）。
- KG「全自動抽出」モード。

---

## 6. リスク
- **object-map(`ObjectMapCanvas`) 自作SVGの画像要素（ドラッグ/リサイズ/z）が最大工数**で別コードパス。既存 `DataObject` ドラッグ＋デバウンス保存に倣って低減。
- **ポリモーフィック FK 不在** → ノード削除で孤児行。各ノード削除サービスに掃除フック必須（漏れると幽霊エンティティ/添付）。
- React Flow のドロップ座標は `screenToFlowPosition` 必須。画像エクスポート時の CORS（既存 SwimlaneCanvas で実績）。
- `KnowledgeNode` の `normalizedLabel` 名寄せで、図ノードが既存同名エンティティにマージされ得る（意図通り＝名寄せだが副作用に注意）。
- 動画 ≤100MB のブラウザ直アップロード上限・配信は302リダイレクト（range ストリーミングなし）― 決定事項により許容。

## 7. 検証
- backend: `prisma generate` → `nest build` → `jest`（DiagramElement/NodeAttachment コントローラ＋KG橋渡しサービスのユニット）。
- frontend: `tsc`(0) / `vitest`（diagram-elements/node-attachments lib・NodeInspectorPanel・ドロップ座標変換の純関数）/ `next build`。
- 手動: 3キャンバスで画像ドロップ→移動/リサイズ、ノードに pdf/動画/画像 添付→閲覧、KG にエンティティ＋文書が出ることを確認、AI抽出を実行。
- 本番: 新3テーブル＋3enumは additive → `db push`。
