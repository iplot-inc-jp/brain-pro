# brain-pro MCP server

brain-pro バックエンド（NestJS, `/api` 全302ルート）を **APIキー認証**で叩く MCP サーバ。
Claude（Code / Desktop）から IPLoT 方法論パイプライン（Ph.0〜7・ASIS/TOBE業務フロー・イシューツリー・GAP・DFD・データカタログ・タスク・リスク・KPI・導入状況）を直接操作できる。

- curated ツール **102個**（モジュール別、下表）
- curated にない操作は `list_capabilities` で探して `api_request` で叩く（全302ルートを網羅）

## セットアップ

```bash
cd mcp
npm install
```

### APIキーの発行（POST /api/api-keys）

1. ログインして JWT を取得:

```bash
curl -s -X POST http://localhost:5021/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@iplot.local","password":"password123"}'
# → { "accessToken": "<JWT>", ... }
```

2. APIキーを発行（**平文キー `sk_...` はこのレスポンスでのみ返る**）:

```bash
curl -s -X POST http://localhost:5021/api/api-keys \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"name":"mcp"}'
# → { "key": "sk_xxxxxxxx...", ... } を控える
```

一覧: `GET /api/api-keys`、失効: `DELETE /api/api-keys/:id`。
APIキーは発行ユーザーの権限で動作する（バックエンドが `x-api-key` ヘッダを受理。Bearer JWT でも可）。

## 環境変数

| 変数 | 既定値 | 説明 |
|---|---|---|
| `AIDATAFLOW_API_URL` | `http://localhost:5021` | バックエンドのベースURL |
| `AIDATAFLOW_API_KEY` | （必須） | 発行した `sk_...` キー |

## Claude Code への登録

```bash
claude mcp add brain-pro \
  -e AIDATAFLOW_API_KEY=sk_... \
  -- node /Users/kazuyukijimbo/brain-pro/mcp/index.mjs
```

本番（Vercel）に向ける場合:

```bash
claude mcp add brain-pro \
  -e AIDATAFLOW_API_URL=https://brain-pro-api.vercel.app \
  -e AIDATAFLOW_API_KEY=sk_... \
  -- node /Users/kazuyukijimbo/brain-pro/mcp/index.mjs
```

## Claude Desktop への登録

`claude_desktop_config.json` に追加:

```json
{
  "mcpServers": {
    "brain-pro": {
      "command": "node",
      "args": ["/Users/kazuyukijimbo/brain-pro/mcp/index.mjs"],
      "env": {
        "AIDATAFLOW_API_URL": "http://localhost:5021",
        "AIDATAFLOW_API_KEY": "sk_..."
      }
    }
  }
}
```

## 手動起動（デバッグ）

```bash
AIDATAFLOW_API_KEY=sk_... node index.mjs
```

接続確認はまず `whoami` ツール（GET /auth/me）を呼ぶ。

## ツール一覧（モジュール別）

### 汎用・コア（tools/generic.mjs）

| ツール | 説明 |
|---|---|
| `list_capabilities` | OpenAPI 全302ルートをタグ別に列挙（`domain` で部分一致フィルタ）。curated にない操作はまずこれで探す |
| `api_request` | 任意ルートを直接叩く脱出ハッチ（method / path / query / body）。path は `/projects/...` 形式（`/api` プレフィックス不要） |
| `whoami` | GET /auth/me。APIキーの疎通・権限確認 |

### 組織・プロジェクト・フェーズ（tools/projects.mjs）

| ツール | エンドポイント |
|---|---|
| `org_list` | GET /organizations |
| `project_list` | GET /organizations/:organizationId/projects |
| `project_create` | POST /organizations/:organizationId/projects |
| `project_get` | GET /projects/:id |
| `phase_list` | GET /projects/:projectId/phases |
| `phase_initialize` | POST /projects/:projectId/phases/initialize（Ph.0〜7 冪等初期化） |
| `phase_update` | PUT /phases/:id（summary / status / order / detail） |

### 業務フロー（tools/flows.mjs）

| ツール | エンドポイント |
|---|---|
| `flow_list` | GET /business-flows/project/:projectId/all |
| `flow_get` | GET /business-flows/:id（ノード・エッジ同梱） |
| `flow_create` | POST /business-flows（`kind`: ASIS\|TOBE） |
| `flow_update` | PUT /business-flows/:id |
| `flow_delete` | DELETE /business-flows/:id |
| `flow_node_create` | POST /business-flows/:flowId/nodes（positionX/Y 必須） |
| `flow_node_update` | PUT /business-flows/:flowId/nodes/:nodeId |
| `flow_node_delete` | DELETE /business-flows/:flowId/nodes/:nodeId |
| `flow_edge_create` | POST /business-flows/:flowId/edges（sourceNodeId/targetNodeId） |
| `flow_edge_delete` | DELETE /business-flows/:flowId/edges/:edgeId |
| `flow_node_io_set` | PUT /business-flows/:flowId/nodes/:nodeId/information-links（一括置換。DFD の元データ） |
| `flow_mermaid_import` | POST /business-flows/:id/import-mermaid（ノード/エッジの一括生成） |
| `flow_definition_upsert` | PUT /business-flows/:flowId/definition（業務定義シート③） |

### イシューツリー・GAP（tools/issues_gaps.mjs）

| ツール | エンドポイント |
|---|---|
| `issue_tree_list` | GET /projects/:projectId/issue-trees |
| `issue_tree_get` | GET /issue-trees/:id |
| `issue_tree_create` | POST /projects/:projectId/issue-trees |
| `issue_node_add` | POST /issue-trees/:treeId/nodes |
| `issue_node_update` | PUT /issue-trees/:treeId/nodes/:nodeId |
| `issue_node_delete` | DELETE /issue-trees/:treeId/nodes/:nodeId |
| `gap_list` | GET /projects/:projectId/gap-items |
| `gap_create` | POST /projects/:projectId/gap-items |
| `gap_update` | PUT /gap-items/:id（解決/再オープンは api_request で /resolve /reopen） |

### TOBE・要求（tools/tobe_requirements.mjs）

| ツール | エンドポイント |
|---|---|
| `tobe_vision_list` | GET /projects/:projectId/tobe-visions |
| `tobe_vision_create` | POST /projects/:projectId/tobe-visions |
| `tobe_roadmap_list` | GET /projects/:projectId/tobe-roadmaps |
| `tobe_roadmap_create` | POST /projects/:projectId/tobe-roadmaps |
| `requirement_list` | GET /requirements/project/:projectId |
| `requirement_create` | POST /requirements |
| `requirement_update` | PUT /requirements/:id |
| `requirement_link_flow` | POST /requirements/:id/link-flow |

### タスク（tools/tasks.mjs）

| ツール | エンドポイント |
|---|---|
| `task_list` | GET /projects/:projectId/tasks |
| `task_get` | GET /tasks/:id |
| `task_create` | POST /projects/:projectId/tasks |
| `task_update` | PUT /tasks/:id |
| `task_delete` | DELETE /tasks/:id |
| `task_dependency_add` | POST /tasks/:id/dependencies |

### リスク・ステークホルダー（tools/risks_stakeholders.mjs）

| ツール | エンドポイント |
|---|---|
| `risk_list` | GET /projects/:projectId/risks |
| `risk_create` | POST /projects/:projectId/risks |
| `risk_update` | PATCH /risks/:id |
| `risk_delete` | DELETE /risks/:id |
| `risk_category_list` | GET /projects/:projectId/risk-categories（0件なら PMBOK RBS をシード） |
| `stakeholder_list` | GET /projects/:projectId/stakeholders |
| `stakeholder_create` | POST /projects/:projectId/stakeholders |
| `stakeholder_update` | PATCH /stakeholders/:id |
| `stakeholder_domain_assign` | PUT /stakeholders/:id/domain-assignments（領域×RACI 全置換） |

### マスタ（tools/masters.mjs）

| ツール | エンドポイント |
|---|---|
| `sub_project_list` | GET /projects/:projectId/sub-projects |
| `sub_project_create` | POST /projects/:projectId/sub-projects |
| `information_type_list` | GET /projects/:projectId/information-types |
| `information_type_create` | POST /projects/:projectId/information-types |
| `system_list` | GET /projects/:projectId/systems |
| `system_create` | POST /projects/:projectId/systems |
| `constraint_list` | GET /projects/:projectId/constraints |
| `constraint_create` | POST /projects/:projectId/constraints（`title` が必須） |
| `role_list` | GET /roles/project/:projectId（スイムレーンのレーン定義） |
| `role_create` | POST /roles（`type`: HUMAN\|SYSTEM\|OTHER 必須） |

### DFD・データオブジェクト（tools/data_objects_dfd.mjs）

| ツール | エンドポイント |
|---|---|
| `dfd_level1_get` | GET /projects/:projectId/dfd（get-or-create） |
| `dfd_level1_sync` | POST /projects/:projectId/dfd（冪等同期） |
| `dfd_level2_get` | GET /business-flows/:flowId/dfd |
| `dfd_level2_sync` | POST /business-flows/:flowId/dfd |
| `dfd_node_add` | POST /dfd-diagrams/:diagramId/nodes（kind: FUNCTION\|EXTERNAL_ENTITY\|DATA_STORE） |
| `dfd_dataflow_add` | POST /dfd-diagrams/:diagramId/flows（矢印ラベルは `dataItem`） |
| `data_object_list` | GET /projects/:projectId/data-objects（objects＋relations） |
| `data_object_create` | POST /projects/:projectId/data-objects |
| `data_object_update` | PATCH /data-objects/:id |
| `data_object_relation_create` | POST /projects/:projectId/data-object-relations |
| `data_object_import_from_dfd` | POST /projects/:projectId/data-objects/import-from-dfd（冪等） |
| `data_object_link_table` | PUT /tables/:tableId/data-object（null で解除） |
| `data_object_set_sub_project` | PUT /data-objects/:id/sub-project（領域紐付け。null で解除） |
| `data_object_annotation_create` | POST /projects/:projectId/data-object-annotations（kind: STICKY\|COMMENT\|SCOPE） |
| `data_object_apply_scope_links` | POST /data-object-annotations/:id/apply-scope-links（SCOPE枠内を一括領域紐付け） |
| `data_object_import_mermaid` | POST /projects/:projectId/data-objects/import-mermaid（Mermaid をAI解析→オブジェクトマップに取り込み。冪等。**Anthropic APIキー必須**、未設定は 400） |

### データカタログ（tools/catalog.mjs）

| ツール | エンドポイント |
|---|---|
| `table_list` | GET /tables/project/:projectId |
| `table_get` | GET /tables/:id |
| `table_create` | POST /tables |
| `table_update` | PUT /tables/:id |
| `column_create` | POST /tables/:tableId/columns |
| `crud_mapping_create` | POST /tables/crud-mappings（columnId・roleId・operation 必須） |

### PM（tools/pm.mjs）

| ツール | エンドポイント |
|---|---|
| `charter_get` | GET /projects/:projectId/charter |
| `charter_upsert` | PUT /projects/:projectId/charter |
| `kpi_list` | GET /projects/:projectId/kpis（category/flowId/systemId フィルタ可） |
| `kpi_create` | POST /projects/:projectId/kpis（category: BUSINESS\|AI_QUALITY） |
| `kpi_update` | PATCH /kpis/:id |
| `adoption_status_list` | GET /projects/:projectId/adoption-statuses |
| `adoption_status_upsert` | PUT /projects/:projectId/adoption-statuses/upsert |
| `change_log_list` | GET /projects/:projectId/change-logs（操作履歴・body含む。`limit` 可。会社/全体管理者限定） |

### RBAC（tools/rbac.mjs）

プロジェクト単位のメンバー権限。`*_set` / `*_remove` は管理者（全体管理者 or 会社 OWNER/ADMIN）限定。

| ツール | エンドポイント |
|---|---|
| `project_member_list` | GET /projects/:projectId/members（org 全ユーザー＋実効権限。userId はここから） |
| `project_member_set` | PUT /projects/:projectId/members/:userId（accessLevel: VIEW\|EDIT、upsert） |
| `project_member_remove` | DELETE /projects/:projectId/members/:userId（既定に戻す） |
| `project_my_access` | GET /projects/:projectId/my-access（自分の実効権限。**最低 VIEW が必要**。アクセス権なしは accessLevel:null でなく 403） |

### ジョブ（tools/jobs.mjs）

重いAI生成は**非同期ジョブ**。`ai_job_enqueue` で起票 → `ai_job_get` でポーリングして完了を待つ（本番 QStash／ローカル inline 実行）。

| ツール | エンドポイント |
|---|---|
| `ai_job_enqueue` | POST /projects/:projectId/ai-jobs（type: AI_MERMAID_OBJECTMAP\|AI_MERMAID_FLOW\|AI_KPI\|AI_ISSUE_SUGGEST、payload）。戻り `{jobId, status}`。MERMAID系は payload.mermaid（既存 Mermaid）必須＝生成でなく解析。OBJECTMAP は取り込み済み（再 import 不要）、FLOW は result に flow を返す |
| `ai_job_get` | GET /jobs/:id（status=SUCCEEDED で result を読む） |
| `ai_jobs_list` | GET /projects/:projectId/jobs（直近一覧。`limit` 可） |

## 汎用 `api_request` の使い方

curated ツールにない操作（添付・一括置換シート・スナップショット・AI生成・会議体・各種マスタ管理など）は、
まず `list_capabilities` で探す:

```
list_capabilities { "domain": "GAP" }
→ POST /gap-items/{id}/resolve  "GAP解決（status -> RESOLVED）" など
```

見つけた method/path を `api_request` で叩く（path に `/api` は付けない）:

```
api_request {
  "method": "POST",
  "path": "/gap-items/abc123/resolve"
}

api_request {
  "method": "GET",
  "path": "/projects/xxx/gap-items",
  "query": { "status": "OPEN", "priority": "HIGH" }
}

api_request {
  "method": "POST",
  "path": "/phases/xxx/transition",
  "body": { "status": "IN_PROGRESS" }
}
```

## ファイル構成

```
mcp/
├── index.mjs                  # エントリ（McpServer + 全モジュール登録 + stdio）
├── lib/
│   ├── api.mjs                # fetch クライアント（x-api-key、エラー整形、ok/wrap）
│   └── openapi.mjs            # /api/docs-json のキャッシュ + listOperations(tagFilter?)
└── tools/
    ├── generic.mjs            # list_capabilities / api_request / whoami
    ├── projects.mjs           # 組織・プロジェクト・フェーズ
    ├── flows.mjs              # 業務フロー・業務定義
    ├── issues_gaps.mjs        # イシューツリー・GAP
    ├── tobe_requirements.mjs  # TOBEビジョン/ロードマップ・要求
    ├── tasks.mjs              # タスク（WBS）
    ├── risks_stakeholders.mjs # リスク（RBS）・ステークホルダー（RACI）
    ├── masters.mjs            # 領域/情報種別/システム/制約/ロール
    ├── data_objects_dfd.mjs   # DFD・データオブジェクト（領域紐付け/注釈/Mermaidインポート含む）
    ├── catalog.mjs            # テーブル/カラム/CRUD
    ├── pm.mjs                 # 憲章/KPI/導入状況/変更履歴
    ├── rbac.mjs               # プロジェクト単位メンバー権限（VIEW/EDIT）・my-access
    └── jobs.mjs               # 非同期AIジョブ（enqueue → ai_job_get ポーリング）
```
