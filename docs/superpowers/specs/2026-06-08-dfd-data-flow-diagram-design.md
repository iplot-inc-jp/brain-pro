# DFD（データフロー図）機能 設計

- 日付: 2026-06-08
- 対象: ai-data-flow（Next.js フロント + NestJS/Prisma バックエンド）
- 状態: 設計承認済み（ユーザレビュー前）

## 目的 / 背景

業務フローの INPUT/OUTPUT（情報の種類）を **DFD（Data Flow Diagram）** として表現し、IPA/SEC 流の「DFD（第1レベル）」帳票として清書・画像出力できるようにする。機能要件（プロセス関連）の成果物。

## 確定事項（ユーザ合意）
- **描画スタイル**: SEC「第1レベルDFD」帳票風（参照画像に忠実）＋**色あり**（iplot配色 navy/blue/emerald のアクセント）。PNG画像出力で清書帳票になる。
- **粒度（多レベル）**: 第1レベル＝プロジェクトに1枚で各**業務フローがファンクション**（1-1,1-2…）、第2レベル＝**業務フローごと**でその**ノードがファンクション**。第1のファンクションをクリックで第2へ**ドリルダウン**。
- **生成**: 業務フローから自動生成→編集。外部実体・データストアは手動追加・ドラッグ配置。
- **帳票**: 「データフロー一覧表」（No./源泉/データ項目/宛先/方向/関連処理/帳票種別）。
- **帳票種別**: プロジェクト単位の**帳票種別レジストリ（マスタ）**＋具体帳票ファイルを複数アップロード。DFDの各データフローがマスタを参照。
- **データモデル**: 案A（正規化, 専用モデル）。

参照画像（SEC 第1レベルDFD 帳票）の記法: 外部実体＝四角、外形ファンクション＝角丸、ファンクション＝楕円、情報＝ラベル付き矢印、データストア＝開いた四角（`=`）、システム境界＝破線楕円、帳票ヘッダ（タイトル/ID/作成日付/更新日付/作成者/承認者）＋凡例＋フッタ。

## データモデル（案A: 正規化）

```prisma
enum DfdNodeKind { FUNCTION EXTERNAL_ENTITY DATA_STORE }

model DfdDiagram {
  id          String   @id @default(uuid())
  projectId   String   @map("project_id")
  flowId      String?  @map("flow_id")   // null=第1レベル(プロジェクト) / 値=その業務フローの第2レベル
  title       String?
  docId       String?  @map("doc_id")    // 帳票ID(例 ID:3-2x-00300)
  authorName  String?  @map("author_name")   // 作成者
  approverName String? @map("approver_name") // 承認者
  createdAt   DateTime @default(now()) @map("created_at")   // 作成日付
  updatedAt   DateTime @updatedAt @map("updated_at")        // 更新日付
  project Project       @relation(fields: [projectId], references: [id], onDelete: Cascade)
  flow    BusinessFlow? @relation("FlowDfd", fields: [flowId], references: [id], onDelete: Cascade)
  nodes   DfdNode[]
  flows   DfdFlow[]
  @@unique([projectId, flowId])  // 第1レベルは flowId=null で1枚, 各フロー第2レベルは1枚
  @@map("dfd_diagrams")
}

model DfdNode {
  id         String      @id @default(uuid())
  diagramId  String      @map("diagram_id")
  kind       DfdNodeKind
  label      String
  number     String?     // 第1:"1-2" 等の採番(編集可)
  refFlowId  String?     @map("ref_flow_id")  // FUNCTION(第1)→業務フロー
  refNodeId  String?     @map("ref_node_id")  // FUNCTION(第2)→FlowNode
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
  dataItem     String   @map("data_item")     // 情報名(矢印ラベル)
  reportTypeId String?  @map("report_type_id") // 帳票種別マスタ参照
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
  name        String   // 帳票種別名(受注書 等)
  description String?  @db.Text
  order       Int      @default(0)
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  project     Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  dfdFlows    DfdFlow[]
  attachments Attachment[]  // 具体帳票ファイル
  @@map("report_types")
}
```
- `Attachment` に `reportTypeId String? @map("report_type_id")` + relation を追加（既存アップロード/配信/削除基盤を流用して具体帳票をアップロード）。
- 注意: Postgres の UNIQUE は NULL を重複扱いしないため `@@unique([projectId, flowId])` だけでは第1レベル（flowId=null）の二重作成を防げない。**第1レベルの一意性は generate/get ユースケースで `findFirst({ projectId, flowId: null })` の get-or-create により担保**（必要なら partial unique index を追加）。第2レベル（flowId=値）は @@unique が効く。
- `Project` に dfdDiagrams/reportTypes、`BusinessFlow` に dfdDiagram(第2)/dfdNodeRefs、`FlowNode` に dfdNodeRefs の back-relation を追加。

## 生成ロジック（業務フローから, 冪等な「再生成/同期」）
- **第1レベル**（projectId, flowId=null）: プロジェクトの各業務フロー→FUNCTIONノード（refFlowId, 番号 1-1…自動採番）。フロー間データフロー＝既存 **FlowNodeLink**（ノード間クロスフローリンク）を「source側ノードの所属フロー→targetFlowId」に畳んで生成（dataItem=リンクlabel）。重複は集約。
- **第2レベル**（flowId=該当）: そのフローの各 FlowNode→FUNCTIONノード（refNodeId）。データフロー＝FlowEdge（node→node, dataItem=エッジlabel or 送信元OUTPUT）。
- 外部実体・データストアは生成では作らず**手動追加**。再生成時は手動ノード・位置・帳票参照・編集を保持（FUNCTIONの過不足のみ同期）。

## 描画（SEC帳票風＋色）
- React Flow カスタムノード: 楕円=FUNCTION（番号＋名、navyアクセント）、四角=EXTERNAL_ENTITY、開いた四角(=)=DATA_STORE（emerald）。エッジ=ラベル付き矢印（dataItem＋帳票種別チップ📎）。破線楕円=システム境界（装飾レイヤ）。
- **帳票チャコール**: 上部ヘッダ（タイトル/docId/作成日付/更新日付/作成者/承認者）＋凡例＋下部フッタ（ページ）。
- **PNG出力**: html-to-image(toPng) で帳票丸ごと画像化。
- ドリルダウン: 第1のFUNCTION(=フロー)をクリック→そのフローの第2DFDへ遷移。パンくず（プロジェクトDFD ＞ 受注フロー）。

## UI 配置
- **第2レベル**: `flows/[flowId]` に「DFD」タブ（フロー図/個別定義/情報の地図 に並ぶ）。
- **第1レベル**: 新ページ `/dashboard/projects/[projectId]/dfd`。サイドバー「設計」グループに「DFD」。
- **データフロー一覧表**: DFDページ/タブ内のサブビュー（`DfdFlow`から No./源泉/データ項目/宛先/方向/関連処理/帳票種別）。
- **帳票種別マスタ**: DFDページ内の「帳票種別」セクション（or 小ページ）。ReportType CRUD＋具体帳票アップロード/DL。

## バックエンド（クリーンアーキ, flow-folder.* をミラー）
- ドメイン: DfdDiagram/DfdNode/DfdFlow/ReportType エンティティ＋各リポジトリ interface+Symbol＋Prisma impl。
- ユースケース: get-diagram(by project=第1 / by flow=第2)、generate-or-sync-diagram、node CRUD（外部実体/データストア追加・移動・削除）、flow(edge) CRUD（dataItem/reportType設定）、bulk-save-positions、report-type CRUD、report-type attachment(アップロード/一覧、既存Attachment配信/削除流用)。
- 認可: project→組織メンバー（全体管理者バイパス）。
- エンドポイント例: `GET/POST projects/:projectId/dfd`(第1, generate含む)、`GET/POST business-flows/:flowId/dfd`(第2)、`PATCH/DELETE dfd-nodes/:id`、`POST/PATCH/DELETE dfd-flows/:id`、`PUT dfd-diagrams/:id/positions`、`GET/POST projects/:projectId/report-types`＋`PATCH/DELETE report-types/:id`＋`POST/GET report-types/:id/attachments`。

## フロント
- `@/lib/dfd.ts`（型・APIクライアント・純粋ヘルパー：採番 assignFunctionNumbers、generationマッピング、データフロー一覧表 row 化）＋vitest。
- `components/dfd/DfdCanvas.tsx`（React Flow, 3ノード型＋境界＋帳票チャコール＋PNG）。
- 第2: flows/[flowId] の「DFD」タブ。第1: /dfd ページ＋サイドバー。データフロー一覧表ビュー。帳票種別マスタ＋アップロードUI（既存 attachment fetch/serve 流用）。

## エラー処理 / 整合
- 未生成時は「生成」ボタン。FlowNodeLink/Edge が無いフローは FUNCTION のみ（フローは手動追加）。
- 削除: diagram/node/flow は Cascade、refFlow/refNode/reportType は SetNull。
- 認可は既存踏襲。

## テスト / 検証
- 純粋関数の vitest: 採番(1-1…)、第1/第2生成マッピング、データフロー一覧表 row 化。
- tsc 0（backend/frontend）、prisma db push、ライブ curl（generate→get、node/flow CRUD、report-type＋attachment、PNGはUI目視）。

## 実装フェーズ（spec は1本、plan で段階化）
- **Phase 1**: モデル＋第2レベル生成＋DfdCanvas編集（SEC帳票風＋色, PNG）＋データフロー一覧表。
- **Phase 2**: 第1レベル（プロジェクトDFDページ＋サイドバー）＋ドリルダウン＋パンくず。
- **Phase 3**: 帳票種別レジストリ（ReportType CRUD＋具体帳票アップロード）＋DFDデータフローからの参照（矢印チップ📎/DL）。

## スコープ外（YAGNI）
- 第3レベル以降の自動分解、DFDの自動整合検査（バランスチェック）、帳票OCR、複数プロジェクト横断DFD。
