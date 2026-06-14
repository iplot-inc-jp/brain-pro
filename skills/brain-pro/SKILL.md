---
name: brain-pro
description: 生成AIが Brain Pro（IPLoT方法論パイプラインのプロジェクト管理ツール）を MCP または REST API 経由で操作するときに使う。プロジェクト/業務フロー(ASIS/TOBE)/イシューツリー/GAP/要件/タスク/リスク/ステークホルダー/KPI/DFD/オブジェクト関係性マップ の読み書きが必要なときに参照する。
---

# Brain Pro 操作スキル

Brain Pro（= ai-data-flow バックエンド）は **IPLoT 方法論**を一気通貫で回すプロジェクト管理ツール。
生成AIエージェントは **MCP サーバ（curated 91ツール）** または **REST API 直叩き（全292オペレーション）** で操作する。

このファイルは入口・地図・ベストプラクティス。具体的なコピペ例は次を参照:
- `references/recipes.md` — タスク別レシピ（curl と MCP 呼び出し例）
- `references/api-cheatsheet.md` — `/api/docs-json` をタグ別に要約した CRUD 早見表

---

## 1. 製品概要（IPLoT 方法論）

Brain Pro はコンサルが業務を「見える化 → 課題分析 → あるべき姿 → 実装」へ落とす一連の流れをデータモデル化している。1プロジェクトの中で以下が連鎖する:

1. **現状把握（ASIS）** — 業務フロー（スイムレーン）でいまの仕事の流れ・担当ロール・流れる情報を描く。
2. **課題分析（イシューツリー / GAP）** — 「なぜ型(WHY)」ツリーで原因を掘り、「打ち手型(SOLUTION)」ツリーで対策を出す。ASIS↔TOBE の差分を **GAP** として台帳化＝これが本当の課題。
3. **あるべき姿（TOBE）** — TOBEビジョン・ロードマップ・TOBE業務フローを描く。
4. **GAP → 要件 / CRUD** — GAP を要件（Requirements）に落とし、データカタログ（テーブル・カラム）と CRUD マッピング（誰がどのデータをCRUDするか）に展開。
5. **推進** — タスク（WBS/ガント）、リスク（RBS）、ステークホルダー（RACI）、KPI（業務KPI×AI精度KPI）、導入状況（定着度）。
6. **データの可視化** — **DFD（データフロー図）** Level1/Level2 と **オブジェクト関係性マップ / ER図** を業務フローの入出力から半自動生成。

各プロジェクトは方法論フェーズ **Ph.0〜7**（`phase_initialize` で冪等初期化）で進捗管理する。

---

## 2. 接続方法（2系統）

### (a) MCP サーバ — まずこちらを推奨

リポジトリ同梱の `mcp/index.mjs`（Node, stdio）。curated 91ツール ＋ 脱出ハッチ（`list_capabilities` / `api_request` / `whoami`）。

**Claude Code に登録:**

```bash
# 本番（Vercel）に向ける
claude mcp add ai-data-flow \
  -e AIDATAFLOW_API_KEY=sk_xxxxxxxx... \
  -e AIDATAFLOW_API_URL=https://brain-pro-api.vercel.app \
  -- node /Users/kazuyukijimbo/ai-data-flow/mcp/index.mjs

# ローカル backend に向ける（AIDATAFLOW_API_URL 省略時の既定が http://localhost:5021）
claude mcp add ai-data-flow \
  -e AIDATAFLOW_API_KEY=sk_xxxxxxxx... \
  -- node /Users/kazuyukijimbo/ai-data-flow/mcp/index.mjs
```

**Claude Desktop に登録**（`claude_desktop_config.json`）:

```json
{
  "mcpServers": {
    "ai-data-flow": {
      "command": "node",
      "args": ["/Users/kazuyukijimbo/ai-data-flow/mcp/index.mjs"],
      "env": {
        "AIDATAFLOW_API_URL": "https://brain-pro-api.vercel.app",
        "AIDATAFLOW_API_KEY": "sk_xxxxxxxx..."
      }
    }
  }
}
```

環境変数:

| 変数 | 既定 | 説明 |
|---|---|---|
| `AIDATAFLOW_API_URL` | `http://localhost:5021` | バックエンドのベースURL（`/api` は付けない） |
| `AIDATAFLOW_API_KEY` | （必須） | 発行した `sk_...` キー |

> MCP の各ツールが内部で叩くパスは `/api` を**付けない**形式（例 `/projects/xxx`）。クライアントが `${URL}/api` を自動で前置する。

### (b) REST API 直叩き

| 環境 | ベースURL |
|---|---|
| 本番 | `https://brain-pro-api.vercel.app/api` |
| ローカル | `http://localhost:5021/api` |

認証ヘッダ（どちらか）:

```
x-api-key: sk_xxxxxxxx...
# または
Authorization: Bearer sk_xxxxxxxx...
# または（UIログインで得た）JWT
Authorization: Bearer <JWT>
```

機械可読仕様: **`GET /api/docs-json`**（OpenAPI 3, 292オペレーション）。
人間用 Swagger UI: **`GET /api/docs`**。

---

## 3. APIキー発行手順

平文キー `sk_...` は**作成レスポンスでのみ**返る（以後は `keyPrefix` のみ）。発行ユーザーの権限で動作する。

```bash
# 1) ログインして JWT を得る（レスポンスの accessToken）
#    認証情報は環境に依存（下の注記を参照）。例は既定シードの開発ユーザー。
curl -s -X POST https://brain-pro-api.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"password123"}'
# → { "accessToken": "<JWT>", "user": {...} }

# 2) APIキーを発行（name 必須。返る "key" が平文 sk_...）
curl -s -X POST https://brain-pro-api.vercel.app/api/api-keys \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"name":"ai-agent"}'
# → { "id": "...", "name": "ai-agent", "keyPrefix": "sk_xxxx", "key": "sk_xxxxxxxx..." }
```

一覧: `GET /api/api-keys` ／ 失効: `DELETE /api/api-keys/:id`。

> 認証情報（パスワードはいずれも `password123`）:
> - **本番（https://brain-pro.iplot.jp / API https://brain-pro-api.vercel.app）には全機能サンプル「発注業務DX」と `demo@iplot.local` / `password123` が投入済み**。すぐログインして全機能（業務フロー/DFD/オブジェクト関係性マップ/課題ツリー/GAP/タスク/リスク/ステークホルダー/KPI 等）を体験できる。
> - ローカル: 既定シード（`prisma db seed` = `prisma/seed.ts`）は `admin@example.com` と `dev@example.com`。`demo@iplot.local` は `npm run seed:demo`（`prisma/seed-demo.ts`）で作成。
> - API/MCP を機械的に使うときは、上記でログイン → `POST /api/api-keys` で自分用の `sk_` キーを発行して使うのが推奨。

---

## 4. 主要ツール / エンドポイントの地図

MCP curated ツール（91個）と対応 REST。MCP path は `/api` 無し、REST は `/api` 付き。

### コア / 脱出ハッチ（generic）
| MCP ツール | REST | 用途 |
|---|---|---|
| `whoami` | `GET /auth/me` | 疎通・認証確認（最初に呼ぶ） |
| `list_capabilities` | `GET /docs-json` を解析 | 全292ルートをタグ別に列挙（`domain` で部分一致フィルタ） |
| `api_request` | 任意 | curated に無い操作を直接実行（method/path/query/body） |

### 組織・プロジェクト・フェーズ（projects）
| MCP | REST |
|---|---|
| `org_list` | `GET /organizations` |
| `project_list` | `GET /organizations/:organizationId/projects` |
| `project_create` | `POST /organizations/:organizationId/projects`（name, slug 必須） |
| `project_get` | `GET /projects/:id` |
| `phase_list` | `GET /projects/:projectId/phases` |
| `phase_initialize` | `POST /projects/:projectId/phases/initialize`（Ph.0〜7 冪等） |
| `phase_update` | `PUT /phases/:id`（summary/status/order/detail） |

### 業務フロー / ASIS・TOBE（flows）
| MCP | REST |
|---|---|
| `flow_list` | `GET /business-flows/project/:projectId/all` |
| `flow_get` | `GET /business-flows/:id`（ノード・エッジ同梱） |
| `flow_create` | `POST /business-flows`（kind: ASIS\|TOBE） |
| `flow_update` / `flow_delete` | `PUT` / `DELETE /business-flows/:id` |
| `flow_node_create` | `POST /business-flows/:flowId/nodes`（positionX/Y 必須、roleId でレーン） |
| `flow_node_update` / `flow_node_delete` | `PUT` / `DELETE /business-flows/:flowId/nodes/:nodeId` |
| `flow_edge_create` / `flow_edge_delete` | `POST` / `DELETE /business-flows/:flowId/edges[/:edgeId]` |
| `flow_node_io_set` | `PUT /business-flows/:flowId/nodes/:nodeId/information-links`（DFDの元データ・全置換） |
| `flow_mermaid_import` | `POST /business-flows/:id/import-mermaid` |
| `flow_definition_upsert` | `PUT /business-flows/:flowId/definition`（業務定義シート③） |

### イシューツリー・GAP（issues_gaps）
| MCP | REST |
|---|---|
| `issue_tree_list` | `GET /projects/:projectId/issue-trees`（type: WHY\|SOLUTION） |
| `issue_tree_get` | `GET /issue-trees/:id` |
| `issue_tree_create` | `POST /projects/:projectId/issue-trees`（gapItemId で GAP に紐付け可） |
| `issue_node_add` | `POST /issue-trees/:treeId/nodes`（kind: ISSUE/CAUSE/COUNTERMEASURE…） |
| `issue_node_update` / `issue_node_delete` | `PUT` / `DELETE /issue-trees/:treeId/nodes/:nodeId` |
| `gap_list` | `GET /projects/:projectId/gap-items`（status/priority/phaseId フィルタ） |
| `gap_create` | `POST /projects/:projectId/gap-items`（businessArea 必須） |
| `gap_update` | `PUT /gap-items/:id` |
| （解決/再オープン） | `api_request`: `POST /gap-items/:id/resolve` ・ `/reopen` |

### TOBE・要件（tobe_requirements）
| MCP | REST |
|---|---|
| `tobe_vision_list` / `tobe_vision_create` | `GET` / `POST /projects/:projectId/tobe-visions` |
| `tobe_roadmap_list` / `tobe_roadmap_create` | `GET` / `POST /projects/:projectId/tobe-roadmaps` |
| `requirement_list` | `GET /requirements/project/:projectId` |
| `requirement_create` / `requirement_update` | `POST /requirements`（title 必須） / `PUT /requirements/:id` |
| `requirement_link_flow` | `POST /requirements/:id/link-flow` |

### タスク（tasks）
| MCP | REST |
|---|---|
| `task_list` | `GET /projects/:projectId/tasks` |
| `task_get` | `GET /tasks/:id` |
| `task_create` | `POST /projects/:projectId/tasks`（title 必須、issueNodeId/riskId 紐付け可） |
| `task_update` / `task_delete` | `PUT` / `DELETE /tasks/:id` |
| `task_dependency_add` | `POST /tasks/:id/dependencies`（predecessorId） |

### リスク・ステークホルダー（risks_stakeholders）
| MCP | REST |
|---|---|
| `risk_list` / `risk_create` | `GET` / `POST /projects/:projectId/risks` |
| `risk_update` / `risk_delete` | `PATCH` / `DELETE /risks/:id` |
| `risk_category_list` | `GET /projects/:projectId/risk-categories`（0件で PMBOK RBS をシード） |
| `stakeholder_list` / `stakeholder_create` | `GET` / `POST /projects/:projectId/stakeholders`（name 必須） |
| `stakeholder_update` | `PATCH /stakeholders/:id` |
| `stakeholder_domain_assign` | `PUT /stakeholders/:id/domain-assignments`（領域×RACI 全置換） |

### マスタ（masters）
| MCP | REST |
|---|---|
| `sub_project_list` / `sub_project_create` | `GET` / `POST /projects/:projectId/sub-projects`（領域） |
| `information_type_list` / `information_type_create` | `GET` / `POST /projects/:projectId/information-types` |
| `system_list` / `system_create` | `GET` / `POST /projects/:projectId/systems` |
| `constraint_list` / `constraint_create` | `GET` / `POST /projects/:projectId/constraints`（title 必須） |
| `role_list` | `GET /roles/project/:projectId`（スイムレーンのレーン定義） |
| `role_create` | `POST /roles`（type: HUMAN\|SYSTEM\|OTHER 必須） |

### DFD・データオブジェクト（data_objects_dfd）
| MCP | REST |
|---|---|
| `dfd_level1_get` / `dfd_level1_sync` | `GET` / `POST /projects/:projectId/dfd` |
| `dfd_level2_get` / `dfd_level2_sync` | `GET` / `POST /business-flows/:flowId/dfd` |
| `dfd_node_add` | `POST /dfd-diagrams/:diagramId/nodes`（kind: FUNCTION\|EXTERNAL_ENTITY\|DATA_STORE） |
| `dfd_dataflow_add` | `POST /dfd-diagrams/:diagramId/flows`（dataItem = 矢印ラベル） |
| `data_object_list` | `GET /projects/:projectId/data-objects`（objects + relations） |
| `data_object_create` / `data_object_update` | `POST /projects/:projectId/data-objects` / `PATCH /data-objects/:id` |
| `data_object_relation_create` | `POST /projects/:projectId/data-object-relations` |
| `data_object_import_from_dfd` | `POST /projects/:projectId/data-objects/import-from-dfd`（冪等） |
| `data_object_link_table` | `PUT /tables/:tableId/data-object`（null で解除） |

### データカタログ（catalog）
| MCP | REST |
|---|---|
| `table_list` / `table_get` | `GET /tables/project/:projectId` / `GET /tables/:id` |
| `table_create` / `table_update` | `POST /tables`（name 必須） / `PUT /tables/:id` |
| `column_create` | `POST /tables/:tableId/columns`（name 必須） |
| `crud_mapping_create` | `POST /tables/crud-mappings`（columnId, operation, roleId 必須） |

### PM（pm）
| MCP | REST |
|---|---|
| `charter_get` / `charter_upsert` | `GET` / `PUT /projects/:projectId/charter` |
| `kpi_list` / `kpi_create` | `GET` / `POST /projects/:projectId/kpis`（category: BUSINESS\|AI_QUALITY） |
| `kpi_update` | `PATCH /kpis/:id` |
| `adoption_status_list` / `adoption_status_upsert` | `GET` / `PUT /projects/:projectId/adoption-statuses[/upsert]` |
| `change_log_list` | `GET /projects/:projectId/change-logs` |

---

## 5. 脱出ハッチ（curated に無い操作）

curated 91ツールは全292オペレーションの代表のみ。**添付ファイル、会議体、関心ごとマトリクス、ASISメモ、コード抽出、GitHub連携、DB接続、商品/仕入先/需要マスタ、スナップショット、AI生成、SMART採点**などは curated に無い。

1. `whoami` で疎通確認 →
2. `list_capabilities { "domain": "添付" }` でタグ部分一致検索 → 正確な method/path を得る →
3. `api_request { "method": "...", "path": "...", "query": {...}, "body": {...} }` で実行。

```jsonc
// 例: GAP を解決済みにする（curated に無い）
api_request { "method": "POST", "path": "/gap-items/<gapId>/resolve" }

// 例: オブジェクト関係性マップのグラフ表現を取得
api_request { "method": "GET", "path": "/projects/<projectId>/er-graph" }

// 例: フィルタ付き一覧
api_request { "method": "GET", "path": "/projects/<projectId>/gap-items", "query": { "status": "OPEN", "priority": "HIGH" } }
```

主なタグ（`list_capabilities` の domain 値）: `Business Flows` / `データオブジェクト（オブジェクト関係性マップ・ER図）` / `DFD（データフロー図）` / `Tables` / `添付` / `イシューツリー` / `Requirements` / `コード抽出` / `組織` / `GAP分析` / `プロジェクトフェーズ` / `GAP` / `タスク` / `KPI（業務KPI・AI精度KPI）` / `ロール` / `GitHub連携` / `ステークホルダー` / `会議体` / `DB接続` ほか（全44タグ）。

---

## 6. 代表レシピ（要点。詳細・コピペは references/recipes.md）

### ① 新規プロジェクト → 領域 → ASIS業務フロー → ノード/エッジ
1. `org_list` → organizationId
2. `project_create { organizationId, name, slug }` → projectId
3. `phase_initialize { projectId }`（Ph.0〜7）
4. `sub_project_create { projectId, name }`（領域）
5. `role_create { projectId, name, type:"HUMAN" }` をレーン分（営業/経理…）
6. `flow_create { projectId, name, kind:"ASIS" }` → flowId
7. `flow_node_create { flowId, label, positionX, positionY, roleId }` を工程分（横220px間隔、Yはレーン内）
8. `flow_edge_create { flowId, sourceNodeId, targetNodeId }` で接続
   - 早い手段: `flow_mermaid_import { id: flowId, mermaid: "flowchart LR; A-->B" }`

### ② 課題ツリー（なぜ掘り）→ 打ち手 → GAP化 → タスク化
1. `issue_tree_create { projectId, name, type:"WHY", rootQuestion }` → treeId
2. `issue_node_add { treeId, label, kind:"ISSUE" }` → 課題ノード、その下に `kind:"CAUSE"` で原因（なぜ掘り、parentId で連鎖）
3. `issue_tree_create { projectId, type:"SOLUTION" }` で打ち手ツリー、`issue_node_add { kind:"COUNTERMEASURE" }`
4. `gap_create { projectId, businessArea, asisDescription, tobeDescription, gapDescription, priority, issueTreeId }`
5. `task_create { projectId, title, issueNodeId }`（打ち手ノードからタスク化）／ `task_dependency_add` で順序付け

### ③ オブジェクト関係性マップ生成
1. ASISフローのノードに `flow_node_io_set { flowId, nodeId, links:[{informationTypeId, direction:"INPUT|OUTPUT"}] }`（information_type を先に作る）
2. `dfd_level1_sync { projectId }`（フロー＋入出力から第1レベルDFDを生成）
3. `data_object_import_from_dfd { projectId }`（DFDのデータストア→データオブジェクトへ冪等取り込み）
4. `data_object_relation_create { projectId, sourceObjectId, targetObjectId, cardinality:"ONE_TO_MANY" }` で関係線
5. 確認: `data_object_list { projectId }` ／ ER図グラフは `api_request GET /projects/:projectId/er-graph`

### ④ リスク / ステークホルダー / KPI
- `risk_category_list { projectId }`（0件なら PMBOK RBS 自動シード）→ `risk_create { projectId, event, probabilityScore, impactScore, strategy, categoryId }`
- `stakeholder_create { projectId, name, influence, support, engagement }` → `stakeholder_domain_assign { id, items:[{subProjectId, raci:"A"}] }`
- `kpi_create { projectId, name, category:"BUSINESS", baselineValue, targetValue, direction:"DECREASE", unit }`（AI精度KPIは `category:"AI_QUALITY"` ＋ `systemId`）

### ⑤ プロジェクト俯瞰（読み取り）
`project_get` → `phase_list` → `flow_list` → `gap_list` → `task_list` → `risk_list` → `kpi_list` → `data_object_list`。
変更履歴は `change_log_list { projectId }`。

---

## 7. ベストプラクティス

- **最初に `whoami`** を呼んで疎通・認証を確認する（失敗したら APIキー/URL を疑う）。
- **ID は必ず実取得値を使う**。`org_list` → `project_*` → 各 `*_list` の順に降りて、レスポンスの `id` を次の呼び出しに渡す。ID をでっち上げない。
- **curated ツールを最優先**。無ければ `list_capabilities` で探し、`api_request` で叩く（推測のパスを書かない）。
- **MCP の path は `/api` 無し**、**REST 直叩きは `/api` 付き**。ローカルは `:5021`、本番は `brain-pro-api.vercel.app`。
- **業務フローのノードは positionX/positionY 必須**。横は約220px間隔、縦はロール（レーン）ごとに帯。`roleId` を付けないとレーンに乗らない。`role_list` で先にレーンを用意する。
- **マスタ依存に注意**: フローの入出力やDFDは `information_type`、CRUD は `column` と `role`、KPI/リスク/ステークホルダーは `sub_project`（領域）を先に作る。
- **DFD/オブジェクトマップは生成系**。手でノードを置くより、フローの入出力を整えてから `dfd_level1_sync` → `data_object_import_from_dfd` を冪等に回すのが正攻法。
- **冪等な初期化**を使う: `phase_initialize` / `*_sync` / `import-from-dfd` は重複作成しないので、迷ったら再実行してよい。
- **破壊的操作（delete系）は慎重に**。タスク削除は子・依存をカスケードする。
- 書き込み後は **対応する `*_list` / `*_get` で確認**し、必要なら `change_log_list` で監査する。
