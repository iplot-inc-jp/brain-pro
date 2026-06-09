# 業務フロー Undo/Redo（スナップショット型）設計

- 日付: 2026-06-09
- ブランチ: feat/methodology-pipeline
- 状態: 設計合意済み。Phase1=業務フロー(SwimlaneCanvas)で確立 → DFD/イシューツリーへ横展開。

## ゴール

各エディタが操作ごとにサーバ保存する現構成で、⌘Z=戻る / ⌘⇧Z(＋⌘Y)=やり直し を実現する。状態は localStorage、履歴は DB に保持し、リロード後も戻れる。まず業務フローで確立し、同じ仕組みを DFD・イシューツリーへ横展開する。

## アーキテクチャ：スナップショット型

操作の前後で「そのフローの編集状態」をスナップショットに取り、戻る＝過去スナップショットへ復元、やり直し＝先のスナップショットへ復元する。命令の逆操作を個別実装しない（堅牢・全操作を一律に扱える）。

### スナップショット
- 1スナップショット = フローの編集状態 JSON:
  - `nodes`: 各ノードの id/type/label/positionX/positionY/order/roleId/processingTime/handledCount/supplement/metadata/childFlowId と informationLinks([{informationTypeId,direction,order}]）。
  - `edges`: 各エッジの id/sourceNodeId/targetNodeId/sourceHandle/targetHandle/label/condition/informationTypeId/pathStyle/labelT/infoT。
  - GET フロー詳細とほぼ同じ形（=フロントが既に持つ flowData を正規化）。
- 取得タイミング: 各確定操作後（ノード作成/移動/編集/削除・エッジ作成/付替/更新/削除・レーン高さ・整形・情報リンク変更 等）。連続ドラッグ等は debounce(〜400ms)で1スナップショットに集約。

### 復元（戻る/やり直しの核）= 新バックエンド
- `PUT /business-flows/:flowId/restore`、body `{ nodes:[...], edges:[...] }`。
- トランザクションで、そのフローのノード/エッジを **スナップショットに一致するよう ID 保持の差分置換**:
  1. nodes: スナップショットに有る id は upsert（全フィールド更新/作成）、DB に有るがスナップショットに無い id は削除。informationLinks は各ノードで replace-all。
  2. edges: 同様に upsert/delete（nodes 確定後に処理して FK 整合）。
- 認可は既存の flow→project→org メンバー確認に合わせる。

### 保存：localStorage（状態）＋ DB（履歴）
- localStorage `flow-undo-<flowId>`: Undo/Redo スタック（直近 N=50 スナップショット）＋現在位置(index)。スタック操作はサーバ往復なしで高速。
- DB 新モデル `FlowSnapshot { id, flowId, seq Int, label String, data Json, createdAt }` + BusinessFlow back-relation。各確定操作で1行追加＝履歴を DB 保持（リロード/別端末で残る）。保持上限超は古い行を間引き（直近 N を維持）。
- エンドポイント: `GET /business-flows/:flowId/snapshots`(直近Nを seq 昇順)、`POST /business-flows/:flowId/snapshots {label,data}`。
- ロード時: DB の直近スナップショットを読み、スタックを復元（現在位置=末尾）。

### キーボード
- ⌘Z=Undo、⌘⇧Z（および⌘Y）=Redo。`metaKey/ctrlKey` 判定。INPUT/TEXTAREA/contentEditable フォーカス中は無効。フローエディタ画面がアクティブな時のみ。

### 動作
- 起動/フロー切替: DB履歴→スタック復元。現在状態を index=末尾に。
- 操作確定: 新状態をスナップ→スタック push（redo 分を破棄）→ localStorage 保存＋ DB POST。
- Undo: index-- → そのスナップを `restore` で適用＋再取得（この再取得では push しない=undoフラグ）。Redo: index++ → 同様。
- 端: これ以上戻れない/進めない時は no-op。

## 影響範囲（Phase1）
- backend: schema(FlowSnapshot + BusinessFlow.snapshots) + db push。business-flow.controller に restore / snapshots(GET/POST)。restore はトランザクション差分置換（PrismaService 直叩き、既存 edge/node 同様）。
- frontend: flows/[flowId]/page.tsx に Undo/Redo フック（スタック state + localStorage 同期 + DB hydrate/persist + restore 呼び出し + ⌘Z/⌘⇧Z keydown）。各操作ハンドラ後にスナップ捕捉（debounce）。SwimlaneCanvas ツールバーに Undo/Redo ボタン（任意・補助）。

## 横展開（後続フェーズ）
- DFD: DfdNode/DfdFlow のスナップショット定義＋`/dfd-diagrams/:id/restore`＋DfdSnapshot。
- イシューツリー: IssueNode のスナップ＋`/issue-trees/:treeId/restore`＋IssueSnapshot（位置は metadata.x/y も含む）。
- 共通フック（useSnapshotUndo）を抽出して各エディタで再利用。

## 非ゴール（YAGNI）
- 操作単位の逆コマンド方式（命令ログ）は採らない。
- 複数ユーザー同時編集の競合解決は対象外（単独編集前提、最後の restore が勝つ）。
- 無制限履歴は持たない（直近 N=50、DB も間引き）。

## 検証
- backend tsc 0 / frontend tsc 0 / vitest 維持。
- ライブ smoke: フロー作成→ノード/エッジ操作を数手→ restore で1手前/2手前へ正しく戻る（ID保持・付替/位置/情報も復元）、redo で進む、DB snapshots 行が増える、リロード後も ⌘Z で戻れる。
