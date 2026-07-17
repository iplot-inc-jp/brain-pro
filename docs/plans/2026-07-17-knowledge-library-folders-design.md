# ナレッジ横断検索・フォルダ分類 設計

**日付:** 2026-07-17
**対象:** Brain Pro frontend / backend / Prisma

## 目的

RAGで生成した検索用文書から、元のBrain Proレコードと利用可能な元ファイルまで追跡できるようにする。

同時に、RAG生成結果だけでなく、ナレッジ文書・ナレッジノード・チャット・受信リソースを `/dashboard/projects/:projectId/rag` から横断検索し、会社共有テンプレートから作成できる階層フォルダへ自由に複数分類できるようにする。

## 決定事項

- 1つの検索対象は複数フォルダに同時所属できる。
- 既定テンプレートに加え、現在のフォルダ階層をテンプレートとして保存できる。
- ユーザー作成テンプレートは同じ会社の全メンバーで共有する。
- テンプレート適用は既存フォルダを消さず、同階層・同名を再利用して不足分だけ追加する。
- RAGの元データをRAGテーブルへ重複複製せず、各保存先を横断検索する。

## 情報アーキテクチャ

### 横断検索

次の保存先を同一の検索APIでまとめる。

1. `rag_documents`: RAG生成済み概要・コンポーネント
2. `KnowledgeDocument`: ナレッジ取り込み文書
3. `KnowledgeNode`: ナレッジグラフノード
4. `ipro_activity_documents` の `chat`: チャット
5. `ipro_activity_documents` の非 `chat`: 受信リソース

結果は次の共通形式へ正規化する。

```ts
type KnowledgeSearchResult = {
  itemType: 'RAG' | 'KNOWLEDGE_DOCUMENT' | 'KNOWLEDGE_NODE' | 'CHAT' | 'RESOURCE'
  itemId: string
  title: string
  excerpt: string
  occurredAt: string
  sourcePageUrl: string
  sourceFiles: SourceFile[]
  folderIds: string[]
  score: number
}
```

検索元ごとのスコアを正規化し、スコア降順、同点なら新しい順で返す。一部の検索元が失敗した場合は成功分を返し、失敗した検索元を警告として併記する。

### フォルダ分類

```text
KnowledgeFolder
├─ parentId -> KnowledgeFolder
└─ KnowledgeFolderItem[]
   ├─ itemType
   └─ itemId
```

`KnowledgeFolderItem` は `(folderId, itemType, itemId)` で一意にする。複数フォルダ所属を許可し、API境界で `itemType` ごとに実体の `projectId` を検証する。

フォルダ削除は子フォルダと所属情報だけを削除し、検索対象本体を削除しない。RAG再生成は既存upsertで同じRAG項目IDを維持するため、分類も維持できる。

### 会社共有テンプレート

```text
KnowledgeFolderTemplate
└─ KnowledgeFolderTemplateNode
   └─ parentNodeId -> KnowledgeFolderTemplateNode
```

`KnowledgeFolderTemplate` は `organizationId` に属し、同じ会社のメンバーが全プロジェクトで再利用できる。適用はトランザクション内で階層順に行い、同じ親の下の同名フォルダを再利用する。

## 出典トレーサビリティ

検索結果は「元ページ」と「元ファイル」を分けて持つ。

RAG生成結果のファイル出典は `RagSourceReference` として正規化し、`RagDocument` の更新と同じトランザクションで入れ替える。

```text
RagDocument
└─ RagSourceReference
   ├─ kind: FILE | EXTERNAL
   ├─ label / filename / mimeType
   └─ url
```

- 元ページ: タスク、業務フロー、会議、要件、ナレッジ詳細、チャット履歴など
- 元ファイル: `Attachment` 配信URL、Vercel Blob、`KnowledgeDocument.blobUrl`、Google Docs URL、受信リソースのメディアURLなど

RAG生成時は元レコードが持つ添付・文書情報をソースメタデータへ含め、RAG文書のupsertと同時に更新する。ファイルが存在しない構造化データは元ページだけを表示する。

## UI設計

### サイドメニュー

```text
ナレッジ
├─ チャット履歴
├─ リソース履歴
├─ フォルダ
├─ ナレッジ取り込み
├─ ナレッジグラフ
├─ ナレッジ一覧編集
├─ RAG索引
└─ ナレッジ設定
```

`/dashboard/projects/:projectId/knowledge/folders` に専用画面を追加する。

### RAG索引画面

`すべて / RAG / ナレッジ / チャット / リソース` の検索対象タブを追加する。各結果に種別、要約、検索スコア、所属フォルダ、元ページ、元ファイルを表示する。

### フォルダ画面

デスクトップは次の3ペインとする。

```text
フォルダツリー | 横断検索結果 | 選択項目・出典・所属先
```

- `未分類` を仮想フォルダとして表示する。
- フォルダ作成、子フォルダ作成、改名、移動、削除を提供する。
- 検索結果をツリーへドラッグしたときは、既存所属を外さず追加する。
- 複数選択と複数フォルダへの一括分類を提供する。
- 右ペインで全所属先をチェックボックス編集できる。
- モバイルはフォルダツリーをドロワー、詳細を一覧下部へ移す。

### テンプレートUI

- `テンプレートから作成` で既定・会社共有テンプレートを選ぶ。
- `現在の構成をテンプレート保存` で会社共有テンプレートを作成する。
- ユーザー作成テンプレートは改名・削除できる。
- 既定テンプレートはコード定義とし、DBに重複保存しない。

## 権限

- 検索・フォルダ閲覧: プロジェクト閲覧権限
- フォルダ作成・分類変更: プロジェクト編集権限
- 会社共有テンプレート作成・変更: 同じ会社のメンバー
- 別会社・別プロジェクトのフォルダ、項目、テンプレートIDはAPIで拒否する。

## エラー処理

- 横断検索の一部失敗で成功結果を捨てない。
- 分類変更は楽観的更新し、API失敗時に元へ戻す。
- テンプレート適用はトランザクションで全件成功または全件ロールバックとする。
- フォルダ削除前に子フォルダ数と所属件数を表示する。
- 元ファイルが削除済みの場合は利用不可を表示し、元ページの導線は残す。

## テスト方針

- フォルダ階層、循環防止、多対多所属
- 会社共有テンプレートの保存、改名、削除、再適用、重複防止
- プロジェクト境界と会社境界
- RAG・ナレッジ・チャット・受信リソースの横断検索とスコア統合
- 元ページ・元ファイルの出典生成
- 検索元の部分障害
- ドラッグ、一括分類、未分類、モバイル表示
- RAG再生成後の分類維持

## 非対象

- フォルダ単位の外部公開・共有URL
- フォルダごとのRAG再生成
- 文書本体のフォルダ間コピー
- 会社を跨ぐテンプレート共有
