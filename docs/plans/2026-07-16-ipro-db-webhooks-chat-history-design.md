# ipro-db 汎用 Webhook・Brain Pro チャット履歴 設計

**日付:** 2026-07-16  
**対象:** `ipro-kun`（送信側） / `brain-pro`（受信・検索側）

## 1. 目的

`ipro-db` のチャット、文書、録画、案件記憶、外部タスクなどの活動データを、会社ごとに登録した複数の外部 URL へ Webhook 配信できるようにする。Brain Pro はそのイベントをプロジェクト単位で受信し、`ipro-db` と同じ「生ログ＋統合検索」の二層構造で保存する。

利用者は Brain Pro の「チャット履歴」で、日本語全文検索と、期間・種別・プラットフォーム・ルーム・発言者・添付有無を組み合わせた高速な絞り込みを行える。Webhook と検索機能の設定、イベント仕様、署名検証、障害調査方法は運用ドキュメントとして両リポジトリに残す。

## 2. スコープ

### 初期イベント

- `chat.message.created`
- `document.created`
- `document.updated`
- `recording.created`
- `recording.ready`
- `project.context.created`
- `project.memory.created`
- `tracker.task.created`
- `tracker.task.updated`

イベントカタログは追加可能な構造にする。削除イベントや他の活動データは後方互換を保ったまま追加する。

### 初期スコープ外

- 外部サービス固有の双方向同期
- Webhook 受信先から `ipro-db` への書き戻し
- Webhook 本文の利用者定義テンプレート
- 任意 JavaScript による本文変換

## 3. 採用方式

イベント台帳と既存 durable-job を利用した非同期 fan-out 配信を採用する。

即時 HTTP 配信は送信先の遅延が元処理へ波及し、一部送信先だけ失敗した際の回復が難しい。Brain Pro からの定期取得は汎用性と即時性が不足する。非同期方式では、元データの保存と外部配信を分離し、URL ごとの再試行、配信履歴、手動再送、重複排除を実現できる。

配信保証は at-least-once とする。受信側は `eventId` を一意に記録して冪等に処理する。

## 4. アーキテクチャ

### 4.1 所有境界

- Webhook 設定、イベント台帳、配信台帳、配信ジョブは `ipro-db` の活動 DB が所有する。
- `ipro-agent` 固有の制御 DB へ Webhook 基盤を置かない。
- `ipro-agent` が Webhook 設定を操作する必要がある場合は、`@ipro/db/api` の公開ポートを通す。
- Brain Pro は受信元設定、受信台帳、活動ログ、統合検索文書を自身の PostgreSQL に保存する。

### 4.2 データフロー

1. `ipro-db` の対象機能がデータを作成または意味のある状態へ更新する。
2. 共通 publisher が標準イベントを `webhook_events` に保存する。
3. ルーターが会社、イベント種別、関連 ipro プロジェクトに一致する有効な送信先を選ぶ。
4. イベント×送信先ごとに `webhook_deliveries` を一意作成し、既存 durable-job へ配信ジョブを投入する。
5. ワーカーが認証情報を付けて送信する。各 URL の成功・再試行・恒久失敗は独立して管理する。
6. Brain Pro は受信元トークンを解決し、HMAC、時刻、プロジェクト権限、`eventId` を検証する。
7. Brain Pro は受信台帳を確保し、チャットならルーム・発言原本・検索文書へ、その他イベントなら検索文書へ正規化して保存する。
8. チャット履歴 API は検索文書を起点に検索し、必要に応じて発言原本と前後文脈を取得する。

### 4.3 複数リンクと複数プロジェクト

Webhook 設定は会社単位で複数登録できる。各 URL は複数イベント、複数 ipro プロジェクトを購読できる。プロジェクト条件が空なら会社内すべてを対象とする。

チャット、録画、文書が複数の ipro プロジェクトに属する場合、イベントは `projectIds: number[]` を持つ。送信先のプロジェクト条件と交差すれば配信対象になる。これにより、1つの ipro プロジェクトから複数 URL への配信と、1イベントから複数 Brain Pro プロジェクトへの取り込みを両立する。

## 5. ipro-db データモデル

### `webhook_endpoints`

- `id`
- `company_id`
- `name`
- `url`
- `auth_type`: `hmac` / `bearer` / `none`
- `secret_enc`: HMAC 秘密鍵または Bearer トークンの暗号文
- `active`
- `timeout_ms`
- `created_at`
- `updated_at`

会社管理者だけが操作できる。URL と秘密情報は通常表示およびログでマスクする。

### `webhook_endpoint_events`

- `endpoint_id`
- `event_type`
- `(endpoint_id, event_type)` 一意

### `webhook_endpoint_projects`

- `endpoint_id`
- `project_id`
- `(endpoint_id, project_id)` 一意

### `webhook_events`

- `id` / 公開 `event_id`
- `spec_version`
- `company_id`
- `event_type`
- `aggregate_type`
- `aggregate_id`
- `project_ids` JSON 配列
- `payload` JSON
- `occurred_at`
- `created_at`

イベント本文は保存時点のスナップショットとする。プロデューサー固有の再取得に依存せず、再送時も同じ本文を送る。

### `webhook_deliveries`

- `id`
- `event_id`
- `endpoint_id`
- `status`: `pending` / `sending` / `retrying` / `succeeded` / `dead`
- `attempt_count`
- `next_attempt_at`
- `last_status_code`
- `last_error`
- `response_snippet`
- `delivered_at`
- `created_at`
- `updated_at`
- `(event_id, endpoint_id)` 一意

配信本文全文、Bearer トークン、HMAC 秘密鍵は配信ログへ書かない。レスポンス抜粋にはサイズ上限を設ける。

## 6. Webhook 契約

```json
{
  "specVersion": "1.0",
  "eventId": "evt_...",
  "eventType": "chat.message.created",
  "companyId": "company-1",
  "projectIds": [12, 18],
  "occurredAt": "2026-07-16T10:00:00.000Z",
  "data": {
    "id": 123,
    "platform": "line",
    "roomId": "room-1",
    "userId": "user-1",
    "userName": "山田",
    "text": "見積条件を確認しました"
  }
}
```

HMAC 送信時は以下を付ける。

- `X-Ipro-Event-Id`
- `X-Ipro-Event-Type`
- `X-Ipro-Timestamp`
- `X-Ipro-Signature: v1=<hex HMAC-SHA256>`

署名対象は `<timestamp>.<raw-body>` とする。Brain Pro は時刻差5分以内、署名の定数時間比較、未処理 `eventId` を確認する。

## 7. Brain Pro データモデル

### `ipro_webhook_sources`

Brain Pro プロジェクトに紐づく受信設定。複数ソースを許可する。

- `id`
- `project_id`
- `name`
- `token_hash`
- `secret_enc`
- `active`
- `last_received_at`
- `last_error`
- `created_at`
- `updated_at`

発行画面では `/api/webhooks/ipro-db/:sourceToken` と HMAC 秘密鍵を一度だけ表示する。

### `ipro_webhook_receipts`

- `event_id` 一意
- `source_id`
- `project_id`
- `event_type`
- `status`
- `error`
- `received_at`
- `processed_at`

### `ipro_activity_rooms`

`ipro-db.chat_rooms` 相当。Brain Pro の `project_id` を加え、`(project_id, platform, external_room_id)` を一意にする。

### `ipro_activity_messages`

`ipro-db.chat_messages` 相当。プラットフォーム、外部ルーム ID、外部メッセージ ID、ルーム種別、発言者 ID・名前、本文、添付、メンション、送信日時、受信イベント ID を保持する。

`(project_id, platform, external_room_id, external_message_id)` を一意にし、バックフィルと通常配信の重複を防ぐ。

### `ipro_activity_documents`

`ipro-db.documents` 相当の統合検索表。チャット、文書、録画、案件コンテキスト、案件記憶、外部タスクを同じ検索面へ集約する。

主な列は `project_id`、`source`、`source_ref`、`platform`、`room_id`、`room_name`、`author_id`、`author_name`、`title`、`content`、`has_media`、`occurred_at`、`event_id` とする。

日本語部分一致には PostgreSQL `pg_trgm` の GIN インデックスを使用する。プロジェクト、種別、プラットフォーム、ルーム、発言者、発生日時には絞り込み用の複合インデックスを設ける。

既存 `KnowledgeDocument` はナレッジグラフ用の編集・抽出成果物であり、生の活動ログとは責務が異なるため混在させない。

## 8. API

### ipro-db 設定・運用 API

- Webhook URL の一覧、作成、編集、停止、削除
- 購読イベントと対象プロジェクトの更新
- テストイベント送信
- 配信履歴一覧と詳細
- 失敗配信の手動再送
- 秘密鍵生成・ローテーション
- 既存データの件数プレビューとバックフィル開始

### Brain Pro API

```text
POST /api/webhooks/ipro-db/:sourceToken
GET  /api/projects/:projectId/chat-history
GET  /api/projects/:projectId/chat-history/facets
GET  /api/projects/:projectId/chat-history/messages/:id/context
```

一覧 API は `q`、`sources[]`、`platforms[]`、`roomIds[]`、`authors[]`、`from`、`to`、`hasMedia`、`sort`、`cursor`、`limit` を組み合わせられる。検索、ファセット、ページングはサーバー側で実行する。

## 9. UI

### ipro-db Webhook 管理

- 会社ごとに複数 URL を一覧表示
- URL、表示名、購読イベント、対象プロジェクト、認証方式の追加・編集
- 有効化、一時停止、削除
- 署名付きテスト送信
- 成功、再試行中、失敗の配信履歴
- 失敗配信の手動再送
- 過去データの対象 URL、イベント、プロジェクト、期間、件数確認、実行

### Brain Pro 受信設定

- プロジェクト設定から複数受信ソースを作成
- URL と HMAC 秘密鍵を発行
- 停止、秘密鍵ローテーション
- 最終受信日時、成功件数、直近エラーを表示

### Brain Pro チャット履歴

サイドメニューの「背景・目的」に追加する。

- 上部固定の全文検索欄
- 「今日」「7日間」「30日間」の期間ショートカット
- 種別、プラットフォーム、ルーム、発言者、添付有無の複数選択
- ファセット件数
- 適用中フィルタのチップ表示と個別解除
- 本文の検索語ハイライト
- URL クエリへの検索条件同期
- カーソルページング
- 結果選択時の前後発言ペイン
- 原文、添付メタデータ、送信元、受信情報の詳細
- `/` で検索欄へ移動、`Esc` で条件解除

## 10. 再試行と障害処理

- 2xx は成功。
- 408、429、5xx、DNS・接続・タイムアウト失敗は指数バックオフ＋ジッターで最大8回再試行する。
- その他の4xxは設定不備として `dead` にし、自動再試行しない。
- 失敗 URL だけを再試行し、他 URL の成功状態を壊さない。
- 手動再送では保存済みイベントスナップショットを使用する。
- Brain Pro の重複受信は既存 receipt を返して成功扱いにする。
- 受信イベントの一部正規化に失敗した場合は receipt にエラーを記録し、原因を隠さない。

## 11. セキュリティ

- 本番の送信 URL は HTTPS のみ許可する。
- localhost、プライベート IP、ループバック、リンクローカル、クラウドメタデータ IP を拒否する。
- DNS 解決後のアドレスも検査し、DNS rebinding を防ぐ。
- リダイレクトは自動追従しない。
- リクエスト・レスポンスサイズ、接続・全体タイムアウトを制限する。
- HMAC は生 body と時刻を対象にし、リプレイを5分で拒否する。
- Webhook 管理は会社管理者、Brain Pro 受信設定はプロジェクト管理者に限定する。
- チャット履歴閲覧は既存のプロジェクト閲覧権限に従う。
- テナント ID、プロジェクト ID、受信 source と URL token の対応をサーバー側で検証し、本文の ID を認可根拠にしない。

## 12. 既存データのバックフィル

Webhook 管理画面から、送信先、イベント種別、ipro プロジェクト、期間を指定して既存データ件数を確認し、バックフィルジョブを開始できる。

バックフィルは小さなカーソルチャンクに分け、通常配信と同じイベント契約、配信台帳、再試行を利用する。イベント ID と外部エンティティの一意キーを決定的に生成し、同じ条件で再実行しても Brain Pro へ二重登録しない。

## 13. テスト

### ipro-kun

- イベントカタログと producer payload
- 会社、イベント、プロジェクト条件による複数 URL fan-out
- HMAC/Bearer/none のヘッダー生成と秘密情報のマスク
- SSRF、DNS 解決、リダイレクト拒否
- 429・5xx 再試行、4xx 停止、最大試行、手動再送
- delivery と job の重複投入防止
- バックフィルのカーソル再開と冪等性
- 会社管理者認可とテナント越境拒否

### Brain Pro

- token、HMAC、時刻、改ざん、リプレイ拒否
- receipt の重複排除
- 同一チャットの複数 Brain Pro プロジェクト取り込み
- ルーム・発言・統合文書への正規化
- 日本語部分一致と複合フィルタ
- ファセット、カーソルページング、前後発言取得
- プロジェクト越境拒否
- URL フィルタ同期、空状態、読み込み・エラー状態

## 14. ドキュメント

### `ipro-kun/docs/outgoing-webhooks.md`

- Webhook 登録と複数 URL 設定
- イベントカタログと payload 例
- HMAC 検証例
- ステータス、再試行、手動再送
- バックフィル
- SSRF と秘密情報の扱い
- 新しいイベントを追加する開発手順
- トラブルシューティング

### `brain-pro/docs/ipro-db-chat-history.md`

- 受信 URL と秘密鍵の発行
- `ipro-db` 側の接続設定
- `ipro-db` と Brain Pro の DB 対応表
- 検索 API とフィルタ例
- 重複排除とバックフィル
- 秘密鍵ローテーション
- 配信失敗・署名失敗・検索不一致の調査手順

受信 API、検索 API、設定 API は OpenAPI にもサンプル本文、ヘッダー、エラーレスポンスを掲載する。

## 15. 完了条件

- 1社に複数 URL を登録し、URL ごとにイベントとプロジェクトを選べる。
- 1イベントが一致する全 URL へ独立配信される。
- 一部 URL の障害が元機能と他 URL の配信を止めない。
- Brain Pro が通常配信とバックフィルを重複なく取り込める。
- チャット履歴で日本語検索とすべての指定フィルタを組み合わせられる。
- 検索条件が URL に残り、前後の発言を確認できる。
- 配信・受信・検索の認可、署名、SSRF、越境テストが通る。
- 両リポジトリの運用ドキュメントと OpenAPI が実装に一致する。
