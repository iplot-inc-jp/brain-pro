---
name: brain-pro
description: 生成AIが Brain Pro（IPLoT方法論パイプラインのプロジェクト管理ツール）を MCP または REST API 経由で操作するときに使う。プロジェクト/業務フロー(ASIS/TOBE)/イシューツリー/GAP/要件/タスク/リスク/ステークホルダー/KPI/DFD/オブジェクト関係性マップ の読み書きが必要なときに参照する。
---

# Brain Pro 操作スキル

Brain Pro（= brain-pro バックエンド）は **IPLoT 方法論**を一気通貫で回すプロジェクト管理ツール。
生成AIエージェントは **MCP サーバ（curated 102ツール）** または **REST API 直叩き（全302オペレーション）** で操作する。

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

リポジトリ同梱の `mcp/index.mjs`（Node, stdio）。curated 102ツール ＋ 脱出ハッチ（`list_capabilities` / `api_request` / `whoami`）。

**Claude Code に登録:**

```bash
# 本番（Vercel）に向ける
claude mcp add brain-pro \
  -e AIDATAFLOW_API_KEY=sk_xxxxxxxx... \
  -e AIDATAFLOW_API_URL=https://brain-pro-api.vercel.app \
  -- node /Users/kazuyukijimbo/brain-pro/mcp/index.mjs

# ローカル backend に向ける（AIDATAFLOW_API_URL 省略時の既定が http://localhost:5021）
claude mcp add brain-pro \
  -e AIDATAFLOW_API_KEY=sk_xxxxxxxx... \
  -- node /Users/kazuyukijimbo/brain-pro/mcp/index.mjs
```

**Claude Desktop に登録**（`claude_desktop_config.json`）:

```json
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

機械可読仕様: **`GET /api/docs-json`**（OpenAPI 3, 302オペレーション / 194パス。認証不要で取得可）。
人間用 Swagger UI: **`GET /api/docs`**。
認証スキーム名は `api-key`（ヘッダ `x-api-key`）と `bearer`（`Authorization: Bearer ...`）。

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
APIキー・JWT どちらも **発行/ログインしたユーザーの権限**で動作する（キー自体に権限は無い）。

> 認証情報（パスワードはいずれも `password123`）:
> - **本番（https://brain-pro.iplot.jp / API https://brain-pro-api.vercel.app）には全機能サンプル「発注業務DX」と `demo@iplot.local` / `password123` が投入済み**。すぐログインして全機能（業務フロー/DFD/オブジェクト関係性マップ/課題ツリー/GAP/タスク/リスク/ステークホルダー/KPI 等）を体験できる。
> - ローカル: 既定シード（`prisma db seed` = `prisma/seed.ts`）は `admin@example.com` と `dev@example.com`。`demo@iplot.local` は `npm run seed:demo`（`prisma/seed-demo.ts`）で作成。
> - API/MCP を機械的に使うときは、上記でログイン → `POST /api/api-keys` で自分用の `sk_` キーを発行して使うのが推奨。

---

## 3.5 権限モデル（RBAC）

権限は **2層**で効く。

1. **会社（組織）ロール** — ユーザーは組織の `OWNER` / `ADMIN` / `MEMBER`。`OWNER`/`ADMIN` は**会社管理者**で、配下プロジェクトに常に EDIT が効き、メンバー権限の設定や操作履歴の閲覧ができる。さらに **全体管理者（super-admin）** は全社・全プロジェクトをまたいで EDIT・管理ができる（`SUPER_ADMIN_EMAILS` で起動時に付与）。
2. **プロジェクト単位のメンバー権限** — 各ユーザーに `VIEW`（閲覧専用）/ `EDIT`（編集可）を明示付与できる。明示が無い場合は会社ロール由来の既定にフォールバックする。

| ツール / REST | 用途 |
|---|---|
| `project_my_access` ／ `GET /projects/:projectId/my-access` | 自分の実効アクセス（`EDIT` / `VIEW`）を確認。書き込み前にこれで EDIT を確かめると安全。ただし**最低 VIEW が要る**（GET なのでアクセスガードが `view` を要求する）。アクセス権の無い project では `null` ではなく **403** が返る |
| `project_member_list` ／ `GET /projects/:projectId/members` | メンバー一覧＋実効権限（`userId` / `email` / `orgRole` / `explicitLevel` / `effectiveLevel`）。**管理者限定** |
| `project_member_set` ／ `PUT /projects/:projectId/members/:userId`（body `{accessLevel: "VIEW"\|"EDIT"}`） | 明示権限を upsert。**管理者限定** |
| `project_member_remove` ／ `DELETE /projects/:projectId/members/:userId` | 明示権限を消して既定に戻す。**管理者限定** |

挙動の要点:
- **閲覧専用（VIEW）で書き込むと `403 Forbidden`**。読み取り（GET 系）は通る。書き込みが 403 になったら、まず `project_my_access` で自分の権限を確認する。
- **`project_my_access` 自体も最低 VIEW を要する**。VIEW も EDIT も無い（実効 `null` 相当の）ユーザーが呼ぶと `{accessLevel:null}` ではなく **403** が返る。よって「触れない project かどうか」の判定は my-access が 403 になること自体で行う。返り値 `null` は VIEW 以上を別経路で持つケースでのみ観測される。
- **メンバー管理 API（members 系）・操作履歴（`change_log_list`）は管理者（会社 OWNER/ADMIN または super-admin）以外は `403`**。
- `members` の対象 `userId` は必ず `project_member_list` の値を使う（対象は同一組織のメンバーである必要がある）。

---

## 4. 主要ツール / エンドポイントの地図

MCP curated ツール（102個）と対応 REST。MCP path は `/api` 無し、REST は `/api` 付き。

### コア / 脱出ハッチ（generic）
| MCP ツール | REST | 用途 |
|---|---|---|
| `whoami` | `GET /auth/me` | 疎通・認証確認（最初に呼ぶ） |
| `list_capabilities` | `GET /docs-json` を解析 | 全302ルートをタグ別に列挙（`domain` で部分一致フィルタ） |
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
| `data_object_import_mermaid` | `POST /projects/:projectId/data-objects/import-mermaid`（Mermaid 記法をAI解析→マップに取り込み。冪等。**Anthropic APIキー必須**、未設定は 400） |
| `data_object_link_table` | `PUT /tables/:tableId/data-object`（null で解除） |
| `data_object_set_sub_project` | `PUT /data-objects/:id/sub-project`（領域＝サブプロジェクトに紐付け／null で解除） |
| `data_object_annotation_create` | `POST /projects/:projectId/data-object-annotations`（kind: STICKY/COMMENT/SCOPE。SCOPE=領域枠） |
| `data_object_apply_scope_links` | `POST /data-object-annotations/:id/apply-scope-links`（SCOPE 枠内のオブジェクトを一括領域紐付け） |

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
| `change_log_list` | `GET /projects/:projectId/change-logs`（**管理者限定**。一般メンバーは 403） |

### RBAC（プロジェクトメンバー権限）（rbac）
| MCP | REST |
|---|---|
| `project_my_access` | `GET /projects/:projectId/my-access`（自分の実効権限。**最低 VIEW が必要**。アクセス権なしは null でなく 403） |
| `project_member_list` | `GET /projects/:projectId/members`（**管理者限定**） |
| `project_member_set` | `PUT /projects/:projectId/members/:userId`（body `{accessLevel:"VIEW"\|"EDIT"}`。**管理者限定**） |
| `project_member_remove` | `DELETE /projects/:projectId/members/:userId`（**管理者限定**） |

### 非同期ジョブ（AI生成）（jobs）
| MCP | REST |
|---|---|
| `ai_job_enqueue` | `POST /projects/:projectId/ai-jobs`（body `{type, payload?}`。戻り `{jobId, status}`） |
| `ai_job_get` | `GET /jobs/:id`（ポーリング用。`status` が SUCCEEDED になったら `result` を読む） |
| `ai_jobs_list` | `GET /projects/:projectId/jobs`（直近一覧） |

`type` 一覧:
- `AI_MERMAID_OBJECTMAP` — `payload.mermaid`（既存の Mermaid テキスト）を AI 解析してオブジェクト関係性マップに取り込む（永続。result `{kind:"OBJECT_GRAPH", graph}`）。
- `AI_MERMAID_FLOW` — `payload.mermaid` を AI 解析して業務フロー構造に変換（永続せず result `{kind:"MERMAID_FLOW", flow}` で返す）。
- `AI_KPI` — KPI 生成（`payload.category` = `BUSINESS`｜`AI_QUALITY` 等）。
- `AI_ISSUE_SUGGEST` — イシュー候補生成（`payload.context`）。

> **注意**: MERMAID 系は「Mermaid を生成する」ジョブではなく「与えた `payload.mermaid` を解析する」処理。mermaid を渡さないと FAILED（`payload.mermaid が必要です`）。説明文から Mermaid を生成する機能は無い。`AI_MERMAID_OBJECTMAP` はジョブ内で取り込みまで完了するので、result を再び import-mermaid に渡してはいけない（二重取り込み）。

本番は Upstash QStash 経由で非同期実行、ローカルは enqueue 内で inline 実行。

---

## 5. 脱出ハッチ（curated に無い操作）

curated 102ツールは全302オペレーションの代表のみ。**添付ファイル、会議体、関心ごとマトリクス、ASISメモ、コード抽出、GitHub連携、DB接続、商品/仕入先/需要マスタ、スナップショット、SMART採点、組織/会社メンバー管理**などは curated に無い。

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

主なタグ（`list_capabilities` の domain 値）: `Business Flows` / `データオブジェクト（オブジェクト関係性マップ・ER図）` / `DFD（データフロー図）` / `Tables` / `添付` / `イシューツリー` / `Requirements` / `コード抽出` / `組織` / `プロジェクトメンバー` / `ジョブ` / `GAP分析` / `プロジェクトフェーズ` / `GAP` / `タスク` / `KPI（業務KPI・AI精度KPI）` / `ロール` / `GitHub連携` / `ステークホルダー` / `会議体` / `DB接続` / `変更履歴` ほか（全47タグ）。

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

### ③ オブジェクト関係性マップ生成（3通り）
- **フローから半自動**: ①ASISフローのノードに `flow_node_io_set { flowId, nodeId, links:[{informationTypeId, direction:"INPUT|OUTPUT"}] }`（information_type を先に作る）→ ②`dfd_level1_sync { projectId }`（第1レベルDFD生成）→ ③`data_object_import_from_dfd { projectId }`（データストア→オブジェクト冪等取り込み）→ ④`data_object_relation_create { projectId, sourceObjectId, targetObjectId, cardinality:"ONE_TO_MANY" }` で関係線。
- **Mermaid を渡して取り込む**: `data_object_import_mermaid { projectId, mermaid:"erDiagram\n  CUSTOMER ||--o{ ORDER : places" }`。mermaid は自分で用意する。**AI 解析を伴うため Anthropic APIキーが必要**（未設定は 400）。冪等。
- **同じ取り込みを非同期ジョブで回す**: `ai_job_enqueue { projectId, type:"AI_MERMAID_OBJECTMAP", payload:{ mermaid:"erDiagram\n ..." } }`（**既存の mermaid を渡す**。mermaid 必須）→ `ai_job_get { id:jobId }` を SUCCEEDED までポーリング → **ジョブ内で取り込み済み**（result `{kind:"OBJECT_GRAPH", graph}`。再 import 不要）。
- **領域分け**: `data_object_set_sub_project { id, subProjectId }` で個別に紐付け。または `data_object_annotation_create { projectId, kind:"SCOPE", subProjectId, positionX, positionY, width, height }` で領域枠を描き `data_object_apply_scope_links { id }` で枠内を一括紐付け。
- 確認: `data_object_list { projectId }` ／ ER図グラフは `api_request GET /projects/:projectId/er-graph`

### ④ リスク / ステークホルダー / KPI
- `risk_category_list { projectId }`（0件なら PMBOK RBS 自動シード）→ `risk_create { projectId, event, probabilityScore, impactScore, strategy, categoryId }`
- `stakeholder_create { projectId, name, influence, support, engagement }` → `stakeholder_domain_assign { id, items:[{subProjectId, raci:"A"}] }`
- `kpi_create { projectId, name, category:"BUSINESS", baselineValue, targetValue, direction:"DECREASE", unit }`（AI精度KPIは `category:"AI_QUALITY"` ＋ `systemId`）

### ⑤ プロジェクト俯瞰（読み取り）
`project_get` → `phase_list` → `flow_list` → `gap_list` → `task_list` → `risk_list` → `kpi_list` → `data_object_list`。
変更履歴は `change_log_list { projectId }`（管理者限定）。

### ⑥ 非同期AIジョブ（enqueue → poll）
1. `ai_job_enqueue { projectId, type:"AI_MERMAID_OBJECTMAP", payload:{ mermaid:"erDiagram\n ..." } }` → `{ jobId, status }`
   - MERMAID 系は `payload.mermaid`（自分が用意した Mermaid）が必須。渡さないと `payload.mermaid が必要です` で FAILED。
2. `ai_job_get { id: jobId }` を `status` が `SUCCEEDED`（または `FAILED`）になるまで数秒間隔でポーリング
3. `SUCCEEDED` なら `result` を読む。
   - `AI_MERMAID_OBJECTMAP`: `result` は `{kind:"OBJECT_GRAPH", graph}`。**ジョブ内で取り込み済みなので import-mermaid に渡し直さない**。
   - `AI_MERMAID_FLOW`: `result` は `{kind:"MERMAID_FLOW", flow}`（クライアント側で適用）。
4. 履歴確認: `ai_jobs_list { projectId }`

### ⑦ プロジェクト権限（RBAC）
1. `project_my_access { projectId }` で自分が EDIT か確認（VIEW なら書き込みは 403）。**my-access 自体も最低 VIEW を要する**ので、アクセス権の無い project では `null` でなく 403 が返る（= 403 ならその project には触れない）。
2. 管理者なら `project_member_list { projectId }` で userId を取得 → `project_member_set { projectId, userId, accessLevel:"VIEW" }` で閲覧専用に → `project_member_remove` で既定に戻す

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
- **書き込み前に権限を意識する**: 403 が返ったら `project_my_access` を確認（VIEW=閲覧専用は書き込めない）。`members` 系・`change_log_list` は管理者限定。
- **重いAI生成は同期で待たず非同期ジョブにする**: `ai_job_enqueue` → `ai_job_get` でポーリング。payload に APIキー等の秘匿情報を入れない。
- 書き込み後は **対応する `*_list` / `*_get` で確認**し、必要なら `change_log_list` で監査する（管理者のみ）。
