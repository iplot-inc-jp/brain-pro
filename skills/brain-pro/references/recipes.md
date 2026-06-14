# Brain Pro レシピ集（curl ＆ MCP コピペ）

実在するツール名/パスのみ。**MCP の `path` は `/api` 無し**、**curl は `/api` 付き**。
変数の前提:

```bash
BASE=https://brain-pro-api.vercel.app/api      # ローカルは http://localhost:5021/api
KEY=sk_xxxxxxxx...                             # APIキー
H=(-H "x-api-key: $KEY" -H "Content-Type: application/json")
```

---

## 0. 疎通・キー発行

```bash
# 疎通確認
curl -s "${H[@]}" $BASE/auth/me        # MCP: whoami

# ログイン → JWT（accessToken）。認証情報は環境依存（既定シードは dev@example.com /
# admin@example.com、demo@iplot.local は npm run seed:demo を実行した場合のみ。本番はシード無し）
curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"password123"}'

# APIキー発行（JWT 必須。返る "key" が平文 sk_...）
curl -s -X POST $BASE/api-keys \
  -H "Authorization: Bearer <JWT>" -H "Content-Type: application/json" \
  -d '{"name":"ai-agent"}'
```

---

## 1. 新規プロジェクト → 領域 → ASIS業務フロー → ノード/エッジ

```bash
# 1) 組織IDを得る
curl -s "${H[@]}" $BASE/organizations
# MCP: org_list

# 2) プロジェクト作成（name, slug 必須）
curl -s -X POST "${H[@]}" $BASE/organizations/<orgId>/projects \
  -d '{"name":"受注業務改革","slug":"juchu-kaikaku","description":"受注プロセスのAI化"}'
# MCP: project_create { "organizationId":"<orgId>", "name":"受注業務改革", "slug":"juchu-kaikaku" }

# 3) フェーズ Ph.0〜7 を冪等初期化
curl -s -X POST "${H[@]}" $BASE/projects/<projectId>/phases/initialize -d '{}'
# MCP: phase_initialize { "projectId":"<projectId>" }

# 4) 領域（サブプロジェクト）
curl -s -X POST "${H[@]}" $BASE/projects/<projectId>/sub-projects \
  -d '{"name":"受注管理"}'
# MCP: sub_project_create { "projectId":"<projectId>", "name":"受注管理" }

# 5) ロール（スイムレーンのレーン。type 必須: HUMAN|SYSTEM|OTHER）
curl -s -X POST "${H[@]}" $BASE/roles \
  -d '{"projectId":"<projectId>","name":"営業","type":"HUMAN","color":"#4F46E5"}'
curl -s -X POST "${H[@]}" $BASE/roles \
  -d '{"projectId":"<projectId>","name":"基幹システム","type":"SYSTEM"}'
# MCP: role_create { "projectId":"<projectId>", "name":"営業", "type":"HUMAN" }

# 6) ASIS業務フロー作成
curl -s -X POST "${H[@]}" $BASE/business-flows \
  -d '{"projectId":"<projectId>","name":"受注処理フロー(現状)","kind":"ASIS","subProjectId":"<subProjectId>"}'
# MCP: flow_create { "projectId":"<projectId>", "name":"受注処理フロー(現状)", "kind":"ASIS" }

# 7) ノード（工程）— positionX/Y 必須、roleId でレーン指定。横220px間隔
curl -s -X POST "${H[@]}" $BASE/business-flows/<flowId>/nodes \
  -d '{"label":"受注を受け付ける","positionX":0,"positionY":80,"roleId":"<roleId営業>","processingTime":"10分"}'
curl -s -X POST "${H[@]}" $BASE/business-flows/<flowId>/nodes \
  -d '{"label":"在庫を引き当てる","positionX":220,"positionY":260,"roleId":"<roleId基幹>"}'
# MCP: flow_node_create { "flowId":"<flowId>", "label":"受注を受け付ける", "positionX":0, "positionY":80, "roleId":"<roleId>" }

# 8) エッジ（矢印）
curl -s -X POST "${H[@]}" $BASE/business-flows/<flowId>/edges \
  -d '{"sourceNodeId":"<nodeA>","targetNodeId":"<nodeB>","label":"受注番号"}'
# MCP: flow_edge_create { "flowId":"<flowId>", "sourceNodeId":"<nodeA>", "targetNodeId":"<nodeB>" }

# --- 早い手段: Mermaid 一括取り込み（ノード/エッジをまとめて生成） ---
curl -s -X POST "${H[@]}" $BASE/business-flows/<flowId>/import-mermaid \
  -d '{"mermaid":"flowchart LR\n A[受注受付] --> B[在庫引当] --> C[出荷指示]"}'
# MCP: flow_mermaid_import { "id":"<flowId>", "mermaid":"flowchart LR\n A-->B-->C" }

# フロー確認（ノード・エッジ同梱）
curl -s "${H[@]}" $BASE/business-flows/<flowId>      # MCP: flow_get { "id":"<flowId>" }
```

業務定義シート③（フロー単位の目的・入出力など）:

```bash
curl -s -X PUT "${H[@]}" $BASE/business-flows/<flowId>/definition \
  -d '{"purpose":"受注を正確・迅速に処理する","input":"顧客からの注文","output":"出荷指示","trigger":"注文受信","doSteps":["受付","与信確認","在庫引当"]}'
# MCP: flow_definition_upsert { "flowId":"<flowId>", "purpose":"...", "doSteps":["..."] }
```

---

## 2. 課題ツリー（なぜ掘り）→ 打ち手 → GAP化 → タスク化

```bash
# 1) なぜ型(WHY)ツリー
curl -s -X POST "${H[@]}" $BASE/projects/<projectId>/issue-trees \
  -d '{"name":"受注遅延の原因","type":"WHY","rootQuestion":"なぜ受注処理が遅いのか"}'
# MCP: issue_tree_create { "projectId":"<projectId>", "name":"受注遅延の原因", "type":"WHY", "rootQuestion":"..." }

# 2) 課題ノード → 原因ノード（parentId で なぜ掘り）
curl -s -X POST "${H[@]}" $BASE/issue-trees/<treeId>/nodes \
  -d '{"label":"受注処理に時間がかかる","kind":"ISSUE"}'
curl -s -X POST "${H[@]}" $BASE/issue-trees/<treeId>/nodes \
  -d '{"label":"手入力が多い","kind":"CAUSE","parentId":"<issueNodeId>","verification":"CONFIRMED"}'
# MCP: issue_node_add { "treeId":"<treeId>", "label":"手入力が多い", "kind":"CAUSE", "parentId":"<issueNodeId>" }

# 3) 打ち手型(SOLUTION)ツリー
curl -s -X POST "${H[@]}" $BASE/projects/<projectId>/issue-trees \
  -d '{"name":"受注AI化の打ち手","type":"SOLUTION"}'
curl -s -X POST "${H[@]}" $BASE/issue-trees/<solTreeId>/nodes \
  -d '{"label":"OCRで受注票を自動取り込み","kind":"COUNTERMEASURE","recommendation":"ADOPT"}'

# 4) GAP化（ASIS↔TOBE 差分 = 本当の課題。businessArea 必須。issueTreeId で打ち手ツリーに紐付け）
curl -s -X POST "${H[@]}" $BASE/projects/<projectId>/gap-items \
  -d '{"businessArea":"受注管理","asisDescription":"手入力で30分","tobeDescription":"OCRで自動化、3分","gapDescription":"入力工数27分/件","priority":"HIGH","issueTreeId":"<solTreeId>"}'
# MCP: gap_create { "projectId":"<projectId>", "businessArea":"受注管理", "priority":"HIGH", ... }

# 5) 打ち手ノードからタスク化（issueNodeId で紐付け）
curl -s -X POST "${H[@]}" $BASE/projects/<projectId>/tasks \
  -d '{"title":"OCRエンジン選定","issueNodeId":"<counterNodeId>","priority":"HIGH","status":"OPEN","dueDate":"2026-07-31"}'
# MCP: task_create { "projectId":"<projectId>", "title":"OCRエンジン選定", "issueNodeId":"<counterNodeId>" }

# タスク依存（後続 <taskB> を 先行 <taskA> に依存させる）
curl -s -X POST "${H[@]}" $BASE/tasks/<taskB>/dependencies \
  -d '{"predecessorId":"<taskA>"}'
# MCP: task_dependency_add { "id":"<taskB>", "predecessorId":"<taskA>" }

# GAP を解決済みにする（curated に無い → api_request / 直叩き）
curl -s -X POST "${H[@]}" $BASE/gap-items/<gapId>/resolve
# MCP: api_request { "method":"POST", "path":"/gap-items/<gapId>/resolve" }
```

---

## 3. オブジェクト関係性マップ / DFD 生成

```bash
# 1) 情報種別マスタ（フロー入出力・DFDの素）
curl -s -X POST "${H[@]}" $BASE/projects/<projectId>/information-types \
  -d '{"name":"受注票","category":"DOCUMENT"}'
# MCP: information_type_create { "projectId":"<projectId>", "name":"受注票", "category":"DOCUMENT" }

# 2) フローノードの入出力を一括セット（全置換。DFDの元データ）
curl -s -X PUT "${H[@]}" $BASE/business-flows/<flowId>/nodes/<nodeId>/information-links \
  -d '{"links":[{"informationTypeId":"<infoTypeId>","direction":"INPUT","order":0},{"informationTypeId":"<infoTypeId2>","direction":"OUTPUT","order":1}]}'
# MCP: flow_node_io_set { "flowId":"<flowId>", "nodeId":"<nodeId>", "links":[{"informationTypeId":"<id>","direction":"INPUT"}] }

# 3) 第1レベルDFDを業務フロー＋入出力から冪等生成
curl -s -X POST "${H[@]}" $BASE/projects/<projectId>/dfd -d '{}'
# MCP: dfd_level1_sync { "projectId":"<projectId>" }
# 取得（get-or-create）: GET $BASE/projects/<projectId>/dfd  /  MCP: dfd_level1_get

# 4) DFDのデータストア → データオブジェクトへ冪等取り込み
curl -s -X POST "${H[@]}" $BASE/projects/<projectId>/data-objects/import-from-dfd -d '{}'
# MCP: data_object_import_from_dfd { "projectId":"<projectId>" }

# 5) オブジェクトを手で足す / 関係線を引く（source=target は拒否）
curl -s -X POST "${H[@]}" $BASE/projects/<projectId>/data-objects \
  -d '{"name":"顧客","color":"#10B981"}'
curl -s -X POST "${H[@]}" $BASE/projects/<projectId>/data-object-relations \
  -d '{"sourceObjectId":"<顧客Id>","targetObjectId":"<受注Id>","cardinality":"ONE_TO_MANY","label":"発注する"}'
# MCP: data_object_relation_create { "projectId":"<projectId>", "sourceObjectId":"...", "targetObjectId":"...", "cardinality":"ONE_TO_MANY" }

# 6) 確認（objects + relations）
curl -s "${H[@]}" $BASE/projects/<projectId>/data-objects     # MCP: data_object_list
# ER図グラフ表現（curated に無い）
curl -s "${H[@]}" $BASE/projects/<projectId>/er-graph         # MCP: api_request GET /projects/<projectId>/er-graph

# 7) データカタログのテーブルをオブジェクトに紐付け（ER統合）
curl -s -X PUT "${H[@]}" $BASE/tables/<tableId>/data-object \
  -d '{"dataObjectId":"<objId>"}'   # 解除は {"dataObjectId":null}
# MCP: data_object_link_table { "tableId":"<tableId>", "dataObjectId":"<objId>" }
```

第2レベル（フロー単位）DFD: `POST $BASE/business-flows/<flowId>/dfd`（MCP `dfd_level2_sync`）。

---

## 4. データカタログ ＆ CRUD マッピング

```bash
# テーブル（name 必須。informationTypeId で情報種別に紐付け可）
curl -s -X POST "${H[@]}" $BASE/tables \
  -d '{"projectId":"<projectId>","name":"orders","displayName":"受注","informationTypeId":"<infoTypeId>"}'
# MCP: table_create { "projectId":"<projectId>", "name":"orders", "displayName":"受注" }

# カラム
curl -s -X POST "${H[@]}" $BASE/tables/<tableId>/columns \
  -d '{"name":"order_id","displayName":"受注ID","dataType":"varchar","isPrimaryKey":true}'
# MCP: column_create { "tableId":"<tableId>", "name":"order_id", "isPrimaryKey":true }

# CRUD マッピング（columnId, operation, roleId 必須。任意で flow/flowNode 紐付け）
curl -s -X POST "${H[@]}" $BASE/tables/crud-mappings \
  -d '{"columnId":"<columnId>","operation":"CREATE","roleId":"<roleId>","flowNodeId":"<nodeId>"}'
# MCP: crud_mapping_create { "columnId":"<columnId>", "operation":"CREATE", "roleId":"<roleId>" }
```

---

## 5. リスク / ステークホルダー / KPI / 憲章

```bash
# リスクカテゴリ（RBS）— 0件なら PMBOK 初期カテゴリが自動シードされる
curl -s "${H[@]}" $BASE/projects/<projectId>/risk-categories   # MCP: risk_category_list

# リスク作成（全フィールド任意。スコア 1-5）
curl -s -X POST "${H[@]}" $BASE/projects/<projectId>/risks \
  -d '{"event":"OCR精度不足で手戻り","probabilityScore":3,"impactScore":4,"strategy":"軽減","countermeasure":"検証期間を設ける","categoryId":"<catId>"}'
# MCP: risk_create { "projectId":"<projectId>", "event":"...", "probabilityScore":3, "impactScore":4 }
# 更新は PATCH /risks/<id>（MCP: risk_update）

# ステークホルダー（name 必須）
curl -s -X POST "${H[@]}" $BASE/projects/<projectId>/stakeholders \
  -d '{"name":"営業部長","affiliation":"営業部","influence":"高","support":"中","side":"INTERNAL"}'
# MCP: stakeholder_create { "projectId":"<projectId>", "name":"営業部長" }

# 担当領域（サブプロジェクト×RACI）を全置換
curl -s -X PUT "${H[@]}" $BASE/stakeholders/<stakeholderId>/domain-assignments \
  -d '{"items":[{"subProjectId":"<subProjectId>","raci":"A"}]}'
# MCP: stakeholder_domain_assign { "id":"<stakeholderId>", "items":[{"subProjectId":"...","raci":"A"}] }

# KPI（category: BUSINESS|AI_QUALITY。業務KPIは flowId、AI精度KPIは systemId）
curl -s -X POST "${H[@]}" $BASE/projects/<projectId>/kpis \
  -d '{"name":"受注処理時間","category":"BUSINESS","unit":"分","baselineValue":30,"targetValue":3,"direction":"DECREASE","frequency":"MONTHLY","flowId":"<flowId>"}'
# MCP: kpi_create { "projectId":"<projectId>", "name":"受注処理時間", "category":"BUSINESS", "direction":"DECREASE" }

# AI精度KPI
curl -s -X POST "${H[@]}" $BASE/projects/<projectId>/kpis \
  -d '{"name":"OCR認識精度","category":"AI_QUALITY","unit":"%","targetValue":98,"direction":"INCREASE","systemId":"<systemId>"}'

# プロジェクト憲章（upsert）
curl -s -X PUT "${H[@]}" $BASE/projects/<projectId>/charter \
  -d '{"background":"受注処理の属人化","purpose":"AI化で処理時間1/10","successCriteria":"処理時間3分以下","scopeIn":"受注管理","scopeOut":"会計"}'
# MCP: charter_upsert { "projectId":"<projectId>", "purpose":"...", "successCriteria":"..." }

# 導入状況（定着度）upsert
curl -s -X PUT "${H[@]}" $BASE/projects/<projectId>/adoption-statuses/upsert \
  -d '{"stakeholderId":"<stakeholderId>","systemId":"<systemId>","stage":"TRIAL","nextAction":"全社展開の説明会"}'
# MCP: adoption_status_upsert { "projectId":"<projectId>", "stakeholderId":"...", "stage":"TRIAL" }
```

---

## 6. TOBE（ビジョン / ロードマップ）と要件

```bash
# TOBEビジョン
curl -s -X POST "${H[@]}" $BASE/projects/<projectId>/tobe-visions \
  -d '{"area":"受注管理","vision":"受注の完全自動化","countermeasure":"OCR+AI判定","effect":"工数90%削減","asisFlowId":"<asisFlowId>"}'
# MCP: tobe_vision_create

# TOBEロードマップ
curl -s -X POST "${H[@]}" $BASE/projects/<projectId>/tobe-roadmaps \
  -d '{"phase":"第1期","measure":"OCR導入","roi":"180%","cost":"500万","payback":"8ヶ月"}'
# MCP: tobe_roadmap_create

# 要件作成（title 必須）
curl -s -X POST "${H[@]}" $BASE/requirements \
  -d '{"projectId":"<projectId>","title":"受注票OCR取り込み","type":"FUNCTIONAL","priority":"HIGH"}'
# MCP: requirement_create { "projectId":"<projectId>", "title":"受注票OCR取り込み" }

# 要件を TOBEフローに紐付け（トレーサビリティ）
curl -s -X POST "${H[@]}" $BASE/requirements/<reqId>/link-flow \
  -d '{"flowId":"<tobeFlowId>","flowNodeId":"<nodeId>"}'
# MCP: requirement_link_flow { "id":"<reqId>", "flowId":"<tobeFlowId>" }

# 自然言語からの一括生成（curated に無い）
curl -s -X POST "${H[@]}" $BASE/requirements/parse \
  -d '{"projectId":"<projectId>","text":"受注票をOCRで読み、基幹に自動登録したい"}'
# MCP: api_request { "method":"POST", "path":"/requirements/parse", "body":{...} }
```

---

## 7. プロジェクト俯瞰（読み取り一括）

```bash
PID=<projectId>
curl -s "${H[@]}" $BASE/projects/$PID              # 概要（MCP: project_get）
curl -s "${H[@]}" $BASE/projects/$PID/phases       # Ph.0〜7（MCP: phase_list）
curl -s "${H[@]}" $BASE/business-flows/project/$PID/all   # フロー一覧（MCP: flow_list）
curl -s "${H[@]}" $BASE/projects/$PID/issue-trees  # イシューツリー（MCP: issue_tree_list）
curl -s "${H[@]}" $BASE/projects/$PID/gap-items    # GAP（MCP: gap_list）
curl -s "${H[@]}" $BASE/projects/$PID/tasks        # タスク（MCP: task_list）
curl -s "${H[@]}" $BASE/projects/$PID/risks        # リスク（MCP: risk_list）
curl -s "${H[@]}" $BASE/projects/$PID/stakeholders # ステークホルダー（MCP: stakeholder_list）
curl -s "${H[@]}" $BASE/projects/$PID/kpis         # KPI（MCP: kpi_list）
curl -s "${H[@]}" $BASE/projects/$PID/data-objects # 関係性マップ（MCP: data_object_list）
curl -s "${H[@]}" $BASE/projects/$PID/change-logs  # 変更履歴（MCP: change_log_list）
```

---

## 8. 脱出ハッチ（任意ルート）

```jsonc
// 全292ルートをタグ別に探索（domain で部分一致フィルタ）
list_capabilities { "domain": "添付" }

// 任意ルートを実行（path は /api 無し。method / query / body）
api_request {
  "method": "GET",
  "path": "/projects/<projectId>/gap-items",
  "query": { "status": "OPEN", "priority": "HIGH" }
}
api_request {
  "method": "POST",
  "path": "/phases/<phaseId>/transition",
  "body": { "status": "IN_PROGRESS" }
}
```

curl で同等のことをする場合は単にパスを叩く（`/api` 付き）:

```bash
curl -s "${H[@]}" "$BASE/projects/<projectId>/gap-items?status=OPEN&priority=HIGH"
```
