# Brain Pro — AI連携ガイド（MCP / REST API）

> このドキュメントは、生成AIエージェント（Claude など）が **Brain Pro**（= brain-pro バックエンド）を
> 自走して操作するための統合ガイドです。AIが仕様を読んで自力で「プロジェクト作成 → 業務フロー → 課題 → GAP → タスク」までを
> 完遂できることをゴールにしています。
>
> 記載のツール名・エンドポイントはすべて実在するものです（裏取り元: `mcp/tools/*.mjs` と `GET /api/docs-json`）。
> 旧 `docs/01〜06`（2024-12 の「DataFlow」データカタログSaaS 設計書）は前身プロダクトの設計書であり、
> 現行の AI 連携仕様は本ドキュメントが正です。

---

## 1. 概要

**Brain Pro** は、IPLoT 方法論（Ph.0 背景 → Ph.1 現状把握/ASIS → Ph.2 ヒアリング → Ph.3 課題構造化 →
Ph.4 TOBE設計+GAP → Ph.5 提案 → Ph.6 要件定義 → Ph.7 推進）を一気通貫でデータモデル化した
プロジェクト管理ツールです。1つのプロジェクトの中で次が連鎖します。

1. **現状把握（ASIS）** — 業務フロー（スイムレーン）で現状の仕事の流れ・担当ロール・流れる情報を描く
2. **課題分析（イシューツリー / GAP）** — 「なぜ型(WHY)」で原因を掘り、「打ち手型(SOLUTION)」で対策を出す。ASIS↔TOBE の差分を **GAP** として台帳化＝これが本当の課題
3. **あるべき姿（TOBE）** — TOBEビジョン / ロードマップ / TOBE業務フロー
4. **GAP → 要件 / CRUD** — GAP を要件（Requirements）へ、データカタログ（テーブル・カラム）と CRUD マッピングへ展開
5. **推進** — タスク（WBS/ガント）・リスク（RBS）・ステークホルダー（RACI）・KPI（業務KPI×AI精度KPI）・導入状況（定着度）
6. **データの可視化** — DFD（データフロー図）Level1/Level2、オブジェクト関係性マップ / ER図 を業務フローの入出力から半自動生成

### 接続は2系統

| 系統 | 何 | こんなとき |
|---|---|---|
| **(a) MCP サーバ** | リポジトリ同梱 `mcp/index.mjs`（Node, stdio）。curated 102ツール ＋ 脱出ハッチ | Claude Code / Desktop から対話的に操作する。**まずこちらを推奨** |
| **(b) REST API + Swagger** | `/api` 全302オペレーション。機械可読仕様 `GET /api/docs-json`、人間用 UI `GET /api/docs` | スクリプト/他言語から叩く、MCP に無い操作を直接叩く |

MCP は内部でこの REST を叩いているだけなので、両者は同じバックエンド・同じ権限で動きます。

---

## 2. 認証

### ベースURL

| 環境 | ベースURL（REST） | MCP の `AIDATAFLOW_API_URL` |
|---|---|---|
| 本番 | `https://brain-pro-api.vercel.app/api` | `https://brain-pro-api.vercel.app` |
| ローカル | `http://localhost:5021/api` | `http://localhost:5021`（既定） |

> REST 直叩きは `/api` 付き。MCP の `AIDATAFLOW_API_URL` は `/api` を**付けない**（クライアントが自動で前置する）。

### 認証ヘッダ（いずれか）

OpenAPI のセキュリティスキーム名は **`api-key`**（ヘッダ `x-api-key`）と **`bearer`**（`Authorization: Bearer ...`）です。

```
x-api-key: sk_xxxxxxxx...
# または
Authorization: Bearer sk_xxxxxxxx...
# または（UIログインで得た）JWT
Authorization: Bearer <JWT>
```

`GET /api/docs-json`（OpenAPI 仕様の取得）だけは**認証不要**です。

### APIキー発行手順

平文キー `sk_...` は**作成レスポンスでのみ**返ります（以後は `keyPrefix` のみ）。
APIキー・JWT は、いずれも**発行/ログインしたユーザーの権限**で動作します（キー自体に独自権限は無い）。

```bash
# 1) ログインして JWT（accessToken）を得る
curl -s -X POST https://brain-pro-api.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@iplot.local","password":"password123"}'
# → { "accessToken": "<JWT>", "user": {...} }

# 2) APIキーを発行（name 必須。任意で projectId。返る "key" が平文 sk_...）
curl -s -X POST https://brain-pro-api.vercel.app/api/api-keys \
  -H "Authorization: Bearer <JWT>" -H "Content-Type: application/json" \
  -d '{"name":"ai-agent"}'
# → { "id":"...", "name":"ai-agent", "keyPrefix":"sk_xxxx", "key":"sk_xxxxxxxx..." }
```

一覧: `GET /api/api-keys` ／ 失効: `DELETE /api/api-keys/:id`。

> **デモ**: 本番（UI `https://brain-pro.iplot.jp` / API `https://brain-pro-api.vercel.app`）には
> 全機能サンプル「発注業務DX」と `demo@iplot.local` / `password123` が投入済み。
> ローカル既定シードは `admin@example.com` / `dev@example.com`、`demo@iplot.local` は `npm run seed:demo` で作成。

---

## 3. 権限モデル（RBAC）

権限は **2層**で効きます。

### (1) 会社（組織）ロール

ユーザーは所属組織で `OWNER` / `ADMIN` / `MEMBER` のいずれか。

- **会社管理者** = `OWNER` / `ADMIN`。配下プロジェクトに常に EDIT が効き、メンバー権限の設定や操作履歴の閲覧ができる。
- **全体管理者（super-admin）** = `SUPER_ADMIN_EMAILS` で起動時に付与される特権ユーザー。全社・全プロジェクトをまたいで EDIT・管理ができる。
- **会社（組織）の作成は全体管理者のみ**（`POST /api/organizations`）。

### (2) プロジェクト単位のメンバー権限

各ユーザーにプロジェクトごとの明示権限 `VIEW`（閲覧専用）/ `EDIT`（編集可）を付与できます。
明示が無ければ会社ロール由来の既定にフォールバックします。

| 操作 | REST | MCP | 権限 |
|---|---|---|---|
| 自分の実効権限を確認 | `GET /projects/:projectId/my-access` | `project_my_access` | **最低 VIEW**（後述） |
| メンバー一覧＋実効権限 | `GET /projects/:projectId/members` | `project_member_list` | 管理者限定 |
| 明示権限を upsert | `PUT /projects/:projectId/members/:userId` body `{accessLevel:"VIEW"｜"EDIT"}` | `project_member_set` | 管理者限定 |
| 明示権限を削除して既定へ | `DELETE /projects/:projectId/members/:userId` | `project_member_remove` | 管理者限定 |

### 挙動の要点（AIが踏みやすい落とし穴）

- **閲覧専用（VIEW）で書き込むと `403 Forbidden`**。読み取り（GET）は通る。書き込みで 403 が出たら、まず `my-access` で自分の権限を確認する。
- **`my-access` 自体も最低 VIEW を要する**（GET なので ProjectAccessGuard が `view` を要求する）。VIEW も EDIT も無いユーザー（=実効 `null` 相当）が呼ぶと、`{accessLevel:null}` ではなく **`403`** が返る。つまり「権限が全く無い project に対し my-access で安全確認する」ことはできず、返り値 `null` は実質「明示メンバー制の project に未掲載」など VIEW 以上を別経路で持つケースでのみ観測される。アクセスできない project かどうかの切り分けは、403 が返ること自体で判断する。
- **メンバー管理 API（members 系）・操作履歴（`change-logs`）は管理者以外 `403`**。
- `members` の対象 `userId` は必ず `project_member_list` の値を使う（同一組織のメンバーである必要がある）。

---

## 4. 非同期ジョブ（AI生成）

重いAI生成（Mermaid 生成・KPI 生成・イシュー候補生成など）は、同期で待たず**ジョブとして起票（enqueue）→ ポーリング**します。
本番は **Upstash QStash** 経由で非同期実行、ローカルは enqueue 内で inline 実行されます。

### 手順（enqueue → poll）

```bash
H=(-H "x-api-key: $KEY" -H "Content-Type: application/json")
BASE=https://brain-pro-api.vercel.app/api

# 1) 起票（type 必須。payload は種別ごとの入力。秘匿情報は入れない）
#    AI_MERMAID_OBJECTMAP / AI_MERMAID_FLOW は payload.mermaid（既存の Mermaid テキスト）が必須。
#    両者は「Mermaid を AI 生成する」ジョブではなく、与えた Mermaid を AI で解析する処理（§4 参照）。
curl -s -X POST "${H[@]}" $BASE/projects/<projectId>/ai-jobs \
  -d '{"type":"AI_MERMAID_OBJECTMAP","payload":{"mermaid":"erDiagram\n  CUSTOMER ||--o{ ORDER : places"}}'
# → { "jobId":"<jobId>", "status":"QUEUED" }

# 2) 完了までポーリング（status が SUCCEEDED / FAILED になるまで数秒間隔）
curl -s "${H[@]}" $BASE/jobs/<jobId>
# → { "id","type","status":"SUCCEEDED","result":{ ... } }

# 3) 直近ジョブ一覧
curl -s "${H[@]}" "$BASE/projects/<projectId>/jobs?limit=20"
```

MCP では `ai_job_enqueue` → `ai_job_get`（ポーリング）→ `ai_jobs_list`。

### type 一覧

| type | 内容 | payload（必須） | result |
|---|---|---|---|
| `AI_MERMAID_OBJECTMAP` | 与えた Mermaid（erDiagram 等）を AI 解析し、**オブジェクト関係性マップに取り込む（永続）** | `mermaid`（既存の Mermaid テキスト） | `{ kind:"OBJECT_GRAPH", graph }`（取り込み後のマップ） |
| `AI_MERMAID_FLOW` | 与えた Mermaid（flowchart 等）を AI 解析し、**業務フロー構造（roles/nodes/edges）に変換**（永続はしない＝compute） | `mermaid`（既存の Mermaid テキスト） | `{ kind:"MERMAID_FLOW", flow }`（クライアント側で適用する） |
| `AI_KPI` | KPI 候補を生成（DRAFT で永続） | `category`（`BUSINESS`｜`AI_QUALITY`）ほか任意 | `{ kind:"KPIS", kpis }` |
| `AI_ISSUE_SUGGEST` | イシュー（課題/原因/打ち手）候補を生成 | `context`（`IssueNodeSuggestContext` 相当） | `{ kind:"ISSUE_SUGGESTIONS", suggestions }` |

> **重要**: `AI_MERMAID_OBJECTMAP` / `AI_MERMAID_FLOW` は「AI に Mermaid を生成させる」ジョブではありません。
> どちらも `payload.mermaid`（**こちらが用意した Mermaid テキスト**）を入力に取り、AI で解析する処理です。
> 「説明文から Mermaid を生成する」機能は未実装なので、`payload:{description:...}` で起票すると
> `payload.mermaid が必要です` でジョブが FAILED になります。
> `AI_MERMAID_OBJECTMAP` はジョブ内で既にマップへ取り込み（永続）済みのため、`result` に `mermaid` は無く、
> result を改めて `import-mermaid` に渡す必要はありません（渡すと二重取り込みになります）。
> Mermaid を「決定的に・自前で組み立てて取り込みたい」だけなら、ジョブを介さず直接
> `POST /projects/:projectId/data-objects/import-mermaid`（同期。これも内部で AI 解析。§6・注記参照）を使います。

---

## 5. MCP ツールの地図

MCP curated **102ツール**（モジュール別の代表）＋ 脱出ハッチ。MCP path は `/api` 無し、REST は `/api` 付き。

### コア / 脱出ハッチ（generic）
| ツール | 対応 | 用途 |
|---|---|---|
| `whoami` | `GET /auth/me` | 疎通・認証確認（**最初に呼ぶ**） |
| `list_capabilities` | `GET /docs-json` を解析 | 全302ルートをタグ別に列挙（`domain` で部分一致フィルタ） |
| `api_request` | 任意ルート | curated に無い操作を直接実行（method/path/query/body） |

### モジュール別（代表ツール）
| モジュール | 代表ツール |
|---|---|
| 組織・プロジェクト・フェーズ（projects） | `org_list` / `project_list` / `project_create` / `project_get` / `phase_list` / `phase_initialize` / `phase_update` |
| 業務フロー ASIS/TOBE（flows） | `flow_list` / `flow_get` / `flow_create` / `flow_node_create` / `flow_edge_create` / `flow_node_io_set` / `flow_mermaid_import` / `flow_definition_upsert` |
| イシューツリー・GAP（issues_gaps） | `issue_tree_create` / `issue_node_add` / `issue_node_update` / `gap_list` / `gap_create` / `gap_update` |
| TOBE・要件（tobe_requirements） | `tobe_vision_create` / `tobe_roadmap_create` / `requirement_create` / `requirement_link_flow` |
| タスク（tasks） | `task_list` / `task_create` / `task_update` / `task_dependency_add` |
| リスク・ステークホルダー（risks_stakeholders） | `risk_category_list` / `risk_create` / `stakeholder_create` / `stakeholder_domain_assign` |
| マスタ（masters） | `sub_project_create`（領域） / `information_type_create` / `system_create` / `constraint_create` / `role_create` |
| DFD・データオブジェクト（data_objects_dfd） | `dfd_level1_sync` / `dfd_level2_sync` / `data_object_list` / `data_object_relation_create` / `data_object_import_from_dfd` / **`data_object_import_mermaid`** / **`data_object_set_sub_project`** / **`data_object_annotation_create`(SCOPE)** / **`data_object_apply_scope_links`** |
| データカタログ（catalog） | `table_create` / `column_create` / `crud_mapping_create` |
| PM（pm） | `charter_upsert` / `kpi_create` / `adoption_status_upsert` / **`change_log_list`**（管理者限定） |
| **RBAC（rbac）** | **`project_my_access`** / **`project_member_list`** / **`project_member_set`** / **`project_member_remove`** |
| **ジョブ（jobs）** | **`ai_job_enqueue`** / **`ai_job_get`** / **`ai_jobs_list`** |

> curated 102ツールは全302オペレーションの代表のみ。**添付ファイル・会議体・関心ごとマトリクス・ASISメモ・
> コード抽出・GitHub連携・DB接続・各種マスタ管理・スナップショット・組織/会社メンバー管理**などは curated に無いので、
> `list_capabilities` → `api_request` で叩きます（§7）。

### Claude Code / Desktop への登録

```bash
# Claude Code（本番に向ける例）
claude mcp add brain-pro \
  -e AIDATAFLOW_API_KEY=sk_xxxxxxxx... \
  -e AIDATAFLOW_API_URL=https://brain-pro-api.vercel.app \
  -- node /Users/kazuyukijimbo/brain-pro/mcp/index.mjs
```

```jsonc
// Claude Desktop（claude_desktop_config.json）
{
  "mcpServers": {
    "brain-pro": {
      "command": "node",
      "args": ["/Users/kazuyukijimbo/brain-pro/mcp/index.mjs"],
      "env": {
        "AIDATAFLOW_API_URL": "https://brain-pro-api.vercel.app",
        "AIDATAFLOW_API_KEY": "sk_xxxxxxxx..."
      }
    }
  }
}
```

| 環境変数 | 既定 | 説明 |
|---|---|---|
| `AIDATAFLOW_API_URL` | `http://localhost:5021` | バックエンドのベースURL（`/api` は付けない） |
| `AIDATAFLOW_API_KEY` | （必須） | 発行した `sk_...` キー |

---

## 6. REST 早見表（主要リソースCRUD）

完全な機械可読仕様は **`GET /api/docs-json`**（OpenAPI 3, 302オペレーション / 194パス）、人間用 UI は **`GET /api/docs`（Swagger UI）**。
タグ別の詳細な早見表は `skills/brain-pro/references/api-cheatsheet.md` を参照。主要リソースのみ抜粋:

| リソース | 一覧 | 作成 | 取得/更新 |
|---|---|---|---|
| 組織 | `GET /organizations` | `POST /organizations`（全体管理者のみ） | — |
| プロジェクト | `GET /organizations/:organizationId/projects` | `POST /organizations/:organizationId/projects`（*name,*slug） | `GET /projects/:id` |
| メンバー権限 | `GET /projects/:projectId/members` | — | `PUT`/`DELETE /projects/:projectId/members/:userId`・`GET /projects/:projectId/my-access` |
| フェーズ | `GET /projects/:projectId/phases` | `POST /projects/:projectId/phases/initialize`（冪等） | `PUT /phases/:id`・`POST /phases/:id/transition` |
| 業務フロー | `GET /business-flows/project/:projectId/all` | `POST /business-flows`（*projectId,*name,kind） | `GET`/`PUT`/`DELETE /business-flows/:id` |
| フローノード | `GET /business-flows/:id`（同梱） | `POST /business-flows/:flowId/nodes`（*label,*positionX,*positionY） | `PUT`/`DELETE /business-flows/:flowId/nodes/:nodeId` |
| イシューツリー | `GET /projects/:projectId/issue-trees` | `POST /projects/:projectId/issue-trees`（type=WHY｜SOLUTION） | `GET`/`PUT`/`DELETE /issue-trees/:id`・ノード `POST /issue-trees/:treeId/nodes` |
| GAP | `GET /projects/:projectId/gap-items` | `POST /projects/:projectId/gap-items`（*businessArea） | `PUT /gap-items/:id`・`POST /gap-items/:id/resolve`・`/reopen` |
| 要件 | `GET /requirements/project/:projectId` | `POST /requirements`（*projectId,*title） | `PUT /requirements/:id`・`POST /requirements/:id/link-flow` |
| タスク | `GET /projects/:projectId/tasks` | `POST /projects/:projectId/tasks`（*title） | `PUT`/`DELETE /tasks/:id`・`POST /tasks/:id/dependencies` |
| リスク | `GET /projects/:projectId/risks` | `POST /projects/:projectId/risks` | `PATCH`/`DELETE /risks/:id` |
| ステークホルダー | `GET /projects/:projectId/stakeholders` | `POST /projects/:projectId/stakeholders`（*name） | `PATCH /stakeholders/:id`・`PUT /stakeholders/:id/domain-assignments` |
| KPI | `GET /projects/:projectId/kpis` | `POST /projects/:projectId/kpis`（*name,category） | `PATCH /kpis/:id` |
| データカタログ | `GET /tables/project/:projectId` | `POST /tables`（*projectId,*name）・`POST /tables/:tableId/columns` | `PUT /tables/:id`・`POST /tables/crud-mappings` |
| DFD | `GET /projects/:projectId/dfd`・`GET /business-flows/:flowId/dfd` | `POST .../dfd`（冪等同期） | `POST /dfd-diagrams/:diagramId/nodes`・`/flows` |
| オブジェクト関係性マップ | `GET /projects/:projectId/data-objects` | `POST /projects/:projectId/data-objects`・`/data-object-relations` | `POST .../import-from-dfd`・`.../import-mermaid`（**AI解析。Anthropic APIキー必須**）・`PUT /data-objects/:id/sub-project` |
| ジョブ | `GET /projects/:projectId/jobs` | `POST /projects/:projectId/ai-jobs`（*type） | `GET /jobs/:id`（ポーリング） |
| 操作履歴 | `GET /projects/:projectId/change-logs`（管理者限定） | — | — |

> enum は仕様の候補値のみを使う（例 `kind`=ASIS｜TOBE、`accessLevel`=VIEW｜EDIT、ジョブ `type`=上記4種）。
> 「行一括置換」系（analysis-*, cruoa, gap-ledgers の PUT）は既存行を入れ替えるので、現状を GET してからマージする。

---

## 7. 代表レシピ

詳細なコピペ例（curl / MCP）は `skills/brain-pro/references/recipes.md`。ここは流れの要点のみ。

### ① プロジェクト作成 → フロー → 課題 → GAP → タスク
1. `org_list` → organizationId（`GET /organizations`）
2. `project_create { organizationId, name, slug }`（`POST /organizations/:organizationId/projects`）→ projectId
3. `phase_initialize { projectId }`（Ph.0〜7 冪等）
4. `role_create`（レーン: 営業/経理/基幹システム…、type=HUMAN｜SYSTEM｜OTHER）
5. `flow_create { projectId, name, kind:"ASIS" }` → `flow_node_create`（positionX/Y 必須、roleId でレーン）→ `flow_edge_create`
   - 早い手段: `flow_mermaid_import { id:flowId, mermaid:"flowchart LR; A-->B" }`
6. `issue_tree_create { type:"WHY", rootQuestion }` → `issue_node_add { kind:"ISSUE" }`→`{ kind:"CAUSE", parentId }`（なぜ掘り）
7. `issue_tree_create { type:"SOLUTION" }` → `issue_node_add { kind:"COUNTERMEASURE", recommendation:"ADOPT" }`
8. `gap_create { projectId, businessArea, asisDescription, tobeDescription, gapDescription, priority, issueTreeId }`
9. `task_create { projectId, title, issueNodeId }`（打ち手ノードからタスク化）→ `task_dependency_add` で順序付け

### ② オブジェクトマップ生成（3通り）
- **フローから半自動**: `flow_node_io_set`（入出力）→ `dfd_level1_sync` → `data_object_import_from_dfd` → `data_object_relation_create`
- **Mermaid から取り込む**: `data_object_import_mermaid { projectId, mermaid:"erDiagram\n CUSTOMER ||--o{ ORDER : places" }`。**Mermaid を AI で解析して取り込む同期処理**（Anthropic APIキーが必要。冪等）
- **同じ取り込みを非同期ジョブで回す**: `ai_job_enqueue { type:"AI_MERMAID_OBJECTMAP", payload:{ mermaid:"..." } }`（既存の Mermaid を渡す）→ `ai_job_get` ポーリング → ジョブ内で取り込み済み（result は `{kind:"OBJECT_GRAPH", graph}`。再 import は不要）
- **領域分け**: `data_object_set_sub_project`、または `data_object_annotation_create { kind:"SCOPE", subProjectId }` → `data_object_apply_scope_links`

### ③ 読み取り俯瞰
`project_get` → `phase_list` → `flow_list` → `gap_list` → `task_list` → `risk_list` → `kpi_list` → `data_object_list`。
変更履歴は `change_log_list { projectId }`（管理者限定）。

---

## 8. AIが自走するための注意

1. **最初に `whoami`（`GET /auth/me`）** で疎通・認証を確認する。失敗したら APIキー/URL を疑う。
2. **`project_my_access` で権限を確認**してから書き込む。閲覧専用（VIEW）は書き込みで 403。ただし my-access 自体も最低 VIEW を要し、アクセス権の無い project では `null` でなく 403 が返る（= my-access が 403 ならその project には触れない）。`members` 系・`change-logs` は管理者限定。
3. **list で全体像を掴む**: `org_list` → `project_list` → `list_capabilities`（タグ別ルート一覧）で地図を持つ。
4. **curated ツールを最優先**。無ければ `list_capabilities { domain:"..." }` で正確な method/path を探し、`api_request` で叩く（パスを推測しない）。
5. **ID は必ず実取得値**を使う。一覧→詳細→作成→更新の順で、レスポンスの `id` を次の呼び出しへ。ID をでっち上げない。
6. **MCP の path は `/api` 無し**、**REST 直叩きは `/api` 付き**。ローカルは `:5021`、本番は `brain-pro-api.vercel.app`。
7. **フローのノードは positionX/positionY 必須**（横220px間隔、縦はロールのレーン帯）。`roleId` を付けないとレーンに乗らない。`role_list` で先にレーンを用意する。
8. **マスタ依存に注意**: 入出力/DFDは `information_type`、CRUD は `column` と `role`、KPI/リスク/ステークホルダーは `sub_project`（領域）を先に作る。
9. **冪等な初期化を使う**: `phase_initialize` / `*_sync` / `import-from-dfd` は重複作成しないので、迷ったら再実行してよい。`import-mermaid` も冪等（get-or-create）だが、これは **AI 解析を伴い Anthropic APIキーが必要**（鍵未設定だと 400『Anthropic APIキーが未設定です』）なので、鍵なしで叩ける純粋な初期化とは別扱い。
10. **重いAI生成は非同期ジョブ**（`ai_job_enqueue` → `ai_job_get` ポーリング）。payload に秘匿情報を入れない。`AI_MERMAID_OBJECTMAP` / `AI_MERMAID_FLOW` は「Mermaid を生成する」のではなく `payload.mermaid`（自分が用意した Mermaid）を解析するジョブで、payload に mermaid が無いと FAILED になる。
11. 書き込み後は **対応する `*_list` / `*_get` で確認**し、必要なら `change_log_list` で監査する（管理者のみ）。

---

## 関連ドキュメント

- `skills/brain-pro/SKILL.md` — Brain Pro 操作スキル（入口・地図・ベストプラクティス）
- `skills/brain-pro/references/recipes.md` — タスク別レシピ（curl / MCP コピペ）
- `skills/brain-pro/references/api-cheatsheet.md` — `/api/docs-json` をタグ別に要約した CRUD 早見表
- `mcp/README.md` — MCP サーバのセットアップとツール一覧
- `GET /api/docs`（Swagger UI）／ `GET /api/docs-json`（OpenAPI、認証不要）
