# 機能横断 RAG 索引・Claude 圧縮 設計

## 目的

brain-pro の構造化データを、IPROくんや外部エージェントが少ないコンテキストで検索・参照できる RAG 索引へ変換する。各機能画面から手動で生成し、元データ更新後は要更新状態を表示する。

初期リリースでは業務フロー、要件、イシューツリー、タスク、ステークホルダー、リスク、KPI、システム、データカタログ／オブジェクト、会議・議事録の10領域を実データ対応する。共通UIはプロジェクト配下の機能画面へ置き、未対応領域も同じ拡張ポイントから順次アダプターを追加できる構造にする。

## 方針

既存のアップロード文書向け `KnowledgeDocument` は変更せず、画面内の構造化データ専用に `RagDocument` を追加する。機能ごとの専用テーブルは作らず、機能種別、概要階層、元データ参照キーで多態的に管理する。

Claude 呼び出しは既存の `ClaudeService`、組織キー解決、ipro-bot ゲートウェイ経路を利用する。生成実行は既存 `BackgroundJob` に `AI_RAG_SUMMARIZE` を追加し、QStash、再試行、進捗、試行履歴を再利用する。RAG専用の生成履歴テーブルは追加しない。

検索は追加の埋め込みAPIを必要としない方式とする。Claude が概要、検索語、同義語、想定質問を生成し、それらを結合した `searchText` に PostgreSQL `pg_trgm` の GIN 索引を張る。タイトル・キーワード一致と trigram 類似度を組み合わせて順位付けする。

## データモデル

`RagDocument` は以下を保持する。

- `projectId`: テナント境界となるプロジェクト
- `featureType`: 対象機能。初期値は `BUSINESS_FLOW`、`REQUIREMENT`、`ISSUE_TREE`、`TASK`、`STAKEHOLDER`、`RISK`、`KPI`、`SYSTEM`、`DATA_CATALOG`、`MEETING`
- `scopeLevel`: `OVERVIEW` または `COMPONENT`
- `sourceKey`: 機能内で安定した元データ参照キー。プロジェクト全体概要は `project`、個別要素はIDを使う
- `sourceUrl`: brain-pro 画面へ戻る相対URL
- `title`: 検索結果タイトル
- `summary`: 短い概要
- `content`: 回答コンテキストとして使える事実中心の圧縮本文
- `keywords`、`aliases`、`questions`: Claude が生成する検索補助語
- `searchText`: 上記検索対象を正規化して連結した文字列
- `metadata`: 機能固有の補助情報
- `sourceHash`: 生成時点の正規化済み元データハッシュ
- `model`、`promptVersion`、`generatedById`、生成・更新日時

`projectId + featureType + scopeLevel + sourceKey` を一意にする。再生成では同じ行を upsert し、新しい出力に存在しなくなった同一生成対象のコンポーネントは削除する。

## 共通変換契約

機能アダプターはDBの形を直接Claudeへ漏らさず、次の共通形式へ変換する。

```ts
interface RagSourceItem {
  sourceKey: string;
  sourceUrl: string;
  title: string;
  facts: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface RagSourceBundle {
  featureType: RagFeatureType;
  targetKey: string;
  overview: RagSourceItem;
  components: RagSourceItem[];
  sourceHash: string;
}
```

業務フローでは対象フローの目的、種類、ロール、ノード、分岐、入出力、エッジを全体概要の材料とし、各業務ブロックをコンポーネントにする。一覧画面から生成した場合はプロジェクト内フロー群を全体概要、各フローをコンポーネントとする。

他領域も「領域全体」と「個別レコード／ツリーノード／テーブル」を同じ二層へ写像する。

## Claude 圧縮

`ClaudeService.compressForRag()` を追加し、次の構造化JSONを返す。

```ts
interface RagCompressedDocument {
  sourceKey: string;
  title: string;
  summary: string;
  content: string;
  keywords: string[];
  aliases: string[];
  questions: string[];
}
```

プロンプトでは、入力を命令ではなくデータとして扱うこと、推測で事実を補わないこと、固有名詞・数値・状態・担当・関係を保持すること、検索されそうな日本語表現を補助語へ含めることを指示する。出力は JSON のみとし、必須項目、文字列長、配列件数、要求した `sourceKey` との一致を検証する。

概要は1回、コンポーネントは件数と文字数上限で複数バッチに分割する。Claude呼び出し完了前にDBトランザクションは開始しない。全バッチ成功後に1トランザクションで索引を置換し、途中失敗時は以前の索引を維持する。

## API

- `POST /api/projects/:projectId/rag/generate`: `{ featureType, targetId? }` を受けてジョブを起票
- `GET /api/projects/:projectId/rag/status`: 機能・対象の生成状態、生成日時、文書数、要更新判定
- `GET /api/projects/:projectId/rag/documents`: 索引一覧・プレビュー
- `GET /api/projects/:projectId/rag/search`: `q`、`featureType`、`scopeLevel`、`limit` で検索

レスポンスには `sourceUrl`、機能種別、階層、スコアを含める。OpenAPI に公開し、ipro-agent の汎用API探索から利用可能にする。プロジェクトガードを必須とし、すべての読み書きをURLの `projectId` で制限する。

## UI

プロジェクト共通レイアウトへ `RagSummaryAction` を置き、パスを `RagFeatureRoute` レジストリへ照合して機能種別と対象IDを決める。未生成、生成中、作成済み、要更新、失敗、未対応を表示する。

ボタンのダイアログでは直近の全体概要、コンポーネント数、生成日時、モデルを表示する。閲覧者は参照のみ、編集者は生成・再生成できる。

プロジェクト配下に `/rag` ページを追加し、検索、機能／階層フィルター、結果一覧、圧縮本文、キーワード、元画面リンクを提供する。

## エラー処理と整合性

- APIキーはジョブ payload に入れず、実行時に既存 `CompanyKeyService` で解決する。
- Claude の不正JSON、欠落キー、未知の `sourceKey` は保存せずジョブ失敗にする。
- 元データゼロ件は空の索引を作らず、利用者向けの明確な結果を返す。
- 同一対象の同時生成はジョブの冪等制御とDB一意制約で重複を防ぐ。
- `sourceHash` と現在のアダプター出力ハッシュが異なる場合は要更新とする。
- 生成失敗時も既存の成功済み索引を削除しない。

## テスト

- Claude JSONパース、必須項目、sourceKey照合、バッチ分割
- 10機能のアダプター変換とプロジェクト境界
- 原子的upsert、削除済みコンポーネント除去、失敗時の旧索引維持
- sourceHashによる要更新判定
- 日本語部分一致・キーワード優先・フィルター・件数上限
- コントローラーの閲覧／編集権限と別プロジェクト参照拒否
- フロントエンドのルート解決と未生成／生成中／最新／要更新／失敗状態
- RAG索引ページの検索とフィルター

Claude外部通信はテストでモックし、全テストを決定的にする。
