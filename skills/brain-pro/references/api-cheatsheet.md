# Brain Pro REST API 早見表（タグ別）

`GET /api/docs-json`（OpenAPI 3, **292オペレーション / 185パス**）をタグ別に要約したもの。
すべて実在エンドポイント。完全な機械可読仕様は `/api/docs-json`、人間用 UI は `/api/docs`。

凡例:
- パスは `/api` 付き（REST 直叩き用）。**MCP の `api_request` で叩く場合は先頭の `/api` を外す**。
- `body:{...}` はリクエストボディの主なフィールド。**`*` 始まりは必須**。`field=A|B|C` は enum 候補。
- パスパラメータは `{...}`。認証は `x-api-key: sk_...`（または `Authorization: Bearer <sk_ or JWT>`）。

ベースURL: 本番 `https://brain-pro-api.vercel.app/api` ／ ローカル `http://localhost:5021/api`

---

### Health (1)
- GET /api/health  — ヘルスチェック

### 認証 (3)
- POST /api/auth/register  — ユーザー登録 body:{*email, *password, name}
- POST /api/auth/login  — ログイン（返り値 accessToken） body:{*email, *password}
- GET /api/auth/me  — 現在のユーザー情報取得

### APIキー (3)
- POST /api/api-keys  — APIキーを発行（平文 key は一度だけ返却） body:{*name, projectId}
- GET /api/api-keys  — APIキー一覧（平文は含まない）
- DELETE /api/api-keys/{id}  — APIキーを失効

### 組織 (8)
- POST /api/organizations  — 組織作成 body:{*name, *slug, description}
- GET /api/organizations  — 組織一覧取得
- GET /api/organizations/{id}/settings  — 会社設定取得
- PUT /api/organizations/{id}/settings  — 会社設定更新 body:{settings}
- GET /api/organizations/{id}/members  — 会社メンバー一覧取得
- POST /api/organizations/{id}/members  — 会社メンバー追加 body:{*email, name, password, role}
- PUT /api/organizations/{id}/members/{userId}  — メンバーのロール/氏名/パスワード変更 body:{role, name, password}
- DELETE /api/organizations/{id}/members/{userId}  — 会社メンバー削除

### プロジェクト (3)
- POST /api/organizations/{organizationId}/projects  — プロジェクト作成 body:{*name, *slug, description}
- GET /api/organizations/{organizationId}/projects  — プロジェクト一覧取得
- GET /api/projects/{id}  — プロジェクト詳細取得

### プロジェクトフェーズ (7)
- GET /api/projects/{projectId}/phases  — フェーズ一覧取得
- POST /api/projects/{projectId}/phases  — フェーズ作成 body:{*kind=BACKGROUND|ASIS_DATA|HEARING|ISSUE_ANALYSIS|TOBE|PROPOSAL|REQUIREMENTS|EXECUTION, order, status=NOT_STARTED|IN_PROGRESS|BLOCKED|APPROVED|DONE, summary, metadata}
- POST /api/projects/{projectId}/phases/initialize  — 全8フェーズ（Ph.0〜7）を冪等初期化
- GET /api/phases/{id}  — フェーズ詳細取得
- PUT /api/phases/{id}  — フェーズ更新 body:{status=NOT_STARTED|IN_PROGRESS|BLOCKED|APPROVED|DONE, order, summary, detail}
- DELETE /api/phases/{id}  — フェーズ削除
- POST /api/phases/{id}/transition  — フェーズ状態遷移 body:{*status=NOT_STARTED|IN_PROGRESS|BLOCKED|APPROVED|DONE}

### プロジェクト憲章 (2)
- GET /api/projects/{projectId}/charter  — 憲章取得（未作成なら null）
- PUT /api/projects/{projectId}/charter  — 憲章 upsert body:{background, purpose, successCriteria, scopeIn, scopeOut, budgetNote, approverStakeholderId, sponsorStakeholderId}

### サブプロジェクト（領域）(4)
- GET /api/projects/{projectId}/sub-projects  — 一覧取得
- POST /api/projects/{projectId}/sub-projects  — 作成 body:{*name, description, order, parentId}
- PUT /api/sub-projects/{id}  — 更新 body:{name, description, order, parentId}
- DELETE /api/sub-projects/{id}  — 削除

### ロール (6)
- GET /api/roles/project/{projectId}  — 一覧取得（スイムレーンのレーン）
- POST /api/roles  — 作成 body:{*projectId, *name, *type=HUMAN|SYSTEM|OTHER, description, color, responsibility, decisionScope, kpi, systemId, subProjectId}
- PATCH /api/roles/{id}  — 更新 body:{name, type=HUMAN|SYSTEM|OTHER, description, color, responsibility, decisionScope, kpi, systemId, subProjectId}
- DELETE /api/roles/{id}  — 削除
- PUT /api/roles/project/{projectId}/order  — 並び順更新 body:{*roleIds}
- PUT /api/roles/{id}/lane-height  — レーン高さ更新 body:{*laneHeight}

### 情報種別 (4)
- GET /api/projects/{projectId}/information-types  — 一覧取得（添付件数付き）
- POST /api/projects/{projectId}/information-types  — 作成 body:{*name, category=INFORMATION|OBJECT|DOCUMENT, description, order, subProjectId}
- PATCH /api/information-types/{id}  — 更新 body:{name, category=INFORMATION|OBJECT|DOCUMENT, description, order, subProjectId}
- DELETE /api/information-types/{id}  — 削除（具体帳票はカスケード）

### システム (4)
- GET /api/projects/{projectId}/systems  — 一覧取得
- POST /api/projects/{projectId}/systems  — 作成 body:{*name, kind=PERIPHERAL|TARGET, description, order, subProjectId}
- PATCH /api/systems/{id}  — 更新 body:{name, kind=PERIPHERAL|TARGET, description, order, subProjectId}
- DELETE /api/systems/{id}  — 削除

### 制約条件 (4)
- GET /api/projects/{projectId}/constraints  — 一覧取得
- POST /api/projects/{projectId}/constraints  — 作成 body:{*title, description, category, kind=CONSTRAINT|ASSUMPTION, order, subProjectId}
- PATCH /api/constraints/{id}  — 更新 body:{title, description, category, kind=CONSTRAINT|ASSUMPTION, order, subProjectId}
- DELETE /api/constraints/{id}  — 削除

### Business Flows (34)
- GET /api/business-flows/project/{projectId}  — ルートフロー一覧
- GET /api/business-flows/project/{projectId}/all  — 全フロー一覧（階層含む）
- GET /api/business-flows/project/{projectId}/tree  — フローツリー（親子フラット配列）
- GET /api/business-flows/{id}  — フロー詳細（ノード・エッジ含む）
- PUT /api/business-flows/{id}  — フロー更新 body:{asisFlowId, folderId, laneHeights, name, description, kind=ASIS|TOBE, confidence=HYPOTHESIS|CONFIRMED, subProjectId}
- DELETE /api/business-flows/{id}  — フロー削除
- POST /api/business-flows  — フロー作成 body:{asisFlowId, folderId, *projectId, *name, description, parentId, kind=ASIS|TOBE, confidence=HYPOTHESIS|CONFIRMED, subProjectId}
- POST /api/business-flows/{flowId}/nodes  — ノード作成 body:{processingTime, handledCount, supplement, type, *label, description, *positionX, *positionY, roleId}
- PUT /api/business-flows/{flowId}/nodes/positions  — ノード位置一括更新 body:{*positions, edges}
- PUT /api/business-flows/{flowId}/nodes/{nodeId}  — ノード更新 body:{width, height, processingTime, handledCount, supplement, type, label, description, positionX, positionY, roleId, order, metadata}
- DELETE /api/business-flows/{flowId}/nodes/{nodeId}  — ノード削除
- POST /api/business-flows/{flowId}/edges  — エッジ作成 body:{sourceHandle, targetHandle, informationTypeId, pathStyle, labelT, infoT, *sourceNodeId, *targetNodeId, label, condition}
- PATCH /api/business-flows/{flowId}/edges/{edgeId}  — エッジ再接続・更新 body:{sourceNodeId, targetNodeId, sourceHandle, targetHandle, informationTypeId, pathStyle, labelT, infoT, label, condition}
- PUT /api/business-flows/{flowId}/edges/{edgeId}  — エッジ更新（同上フィールド）
- DELETE /api/business-flows/{flowId}/edges/{edgeId}  — エッジ削除
- POST /api/business-flows/{flowId}/nodes/{nodeId}/child-flow  — ノードに子フロー作成・紐付け body:{name, description}
- DELETE /api/business-flows/{flowId}/nodes/{nodeId}/child-flow  — 子フロー紐付け解除
- POST /api/business-flows/nodes/{nodeId}/child-flow  — 子フロー（ドリルダウン）作成/取得（冪等） body:{name}
- GET /api/business-flows/nodes/{nodeId}/links  — ノード入出力リンク一覧（双方向）
- POST /api/business-flows/nodes/{nodeId}/links  — 入出力リンク作成 body:{*direction=INPUT|OUTPUT, *targetFlowId, targetNodeId, label}
- DELETE /api/business-flows/node-links/{linkId}  — 入出力リンク削除
- GET /api/business-flows/{flowId}/nodes/{nodeId}/information-links  — ノードの情報種別リンク一覧
- PUT /api/business-flows/{flowId}/nodes/{nodeId}/information-links  — 情報種別リンク一括置換（DFDの素） body:{*links}
- PUT /api/business-flows/{flowId}/restore  — スナップショットに一致するよう差分置換（Undo/Redo） body:{*nodes, *edges}
- GET /api/business-flows/{flowId}/snapshots  — スナップショット履歴取得
- POST /api/business-flows/{flowId}/snapshots  — スナップショット作成 body:{label, *data}
- GET /api/business-flows/{flowId}/annotations  — 注釈（付箋・コメント）一覧
- POST /api/business-flows/{flowId}/annotations  — 注釈作成 body:{kind=STICKY|COMMENT|ICON|SCOPE, width, height, color, icon, borderStyle=dashed|solid, fillOpacity, text, positionX, positionY}
- PATCH /api/business-flows/{flowId}/annotations/{id}  — 注釈部分更新（同上）
- DELETE /api/business-flows/{flowId}/annotations/{id}  — 注釈削除
- GET /api/business-flows/{flowId}/crud-mappings  — フロー紐付けCRUD一覧
- GET /api/business-flows/{flowId}/nodes/{nodeId}/crud-mappings  — ノード紐付けCRUD一覧
- GET /api/business-flows/{id}/mermaid  — Mermaidエクスポート
- POST /api/business-flows/{id}/import-mermaid  — Mermaid図をAI解析して取り込み body:{*mermaid}

### フローフォルダ (4)
- GET /api/projects/{projectId}/flow-folders  — 一覧（parentId付きフラット）
- POST /api/projects/{projectId}/flow-folders  — 作成 body:{*name, parentId, order}
- PATCH /api/flow-folders/{id}  — 更新（リネーム/移動）
- DELETE /api/flow-folders/{id}  — 削除（子はカスケード）

### 業務定義 (3)
- GET /api/projects/{projectId}/flow-definitions  — 業務定義シート①（全フロー）
- GET /api/business-flows/{flowId}/definition  — 個別定義シート③（1フロー取得）
- PUT /api/business-flows/{flowId}/definition  — 個別定義シート③ upsert body:{purpose, owner, stakeholders, input, inputDetail, trigger, doSteps, output, nextProcess, exceptionHandling, frequency, system, tacitNotes}

### イシューツリー (11)
- GET /api/projects/{projectId}/issue-trees  — 一覧（任意で型フィルタ）
- POST /api/projects/{projectId}/issue-trees  — 作成 body:{type=WHY|SOLUTION, pattern=ISSUE_POINT|WHY|WHAT|HOW|MECE_ACTION|KPI, *name, rootQuestion, gapItemId}
- GET /api/projects/{projectId}/issue-nodes  — プロジェクト横断ノード一覧（タスク紐付けセレクタ用）
- GET /api/issue-trees/{id}  — ツリー詳細（ノード含む）
- PUT /api/issue-trees/{id}  — ツリー更新 body:{name, rootQuestion, type=WHY|SOLUTION, pattern=ISSUE_POINT|WHY|WHAT|HOW|MECE_ACTION|KPI}
- DELETE /api/issue-trees/{id}  — ツリー削除
- POST /api/issue-trees/{treeId}/nodes  — ノード追加 body:{parentId, order, *label, kind=ISSUE|CAUSE|COUNTERMEASURE|POINT|HYPOTHESIS|VERIFICATION|RESULT|ELEMENT|OPTION|ACTION|METRIC, verification=CONFIRMED|REJECTED|UNKNOWN|NEEDS_HEARING|NA, recommendation=ADOPT|HOLD|REJECT|NA, evidence, rootCauseNodeId, metadata}
- PUT /api/issue-trees/{treeId}/nodes/{nodeId}  — ノード更新（同上フィールド）
- DELETE /api/issue-trees/{treeId}/nodes/{nodeId}  — ノード削除
- PUT /api/issue-trees/{treeId}/nodes/{nodeId}/verification  — 検証状態設定 body:{*verification=CONFIRMED|REJECTED|UNKNOWN|NEEDS_HEARING|NA, evidence}
- POST /api/issue-trees/{treeId}/nodes/{nodeId}/ai-suggest  — 生成AIで子ノード候補提案（永続化なし） body:{context, ideationMethodName, ideationLenses}

### GAP (7)
- GET /api/projects/{projectId}/gap-items  — GAP一覧（フィルタ可: status, priority, phaseId）
- POST /api/projects/{projectId}/gap-items  — GAP作成 body:{*businessArea, phaseId, asisDescription, tobeDescription, gapDescription, priority=HIGH|MEDIUM|LOW, ownerName, order, asisFlowId, asisNodeId, tobeFlowId, tobeNodeId, issueTreeId}
- GET /api/gap-items/{id}  — GAP詳細
- PUT /api/gap-items/{id}  — GAP更新 body:{businessArea, phaseId, asisDescription, tobeDescription, gapDescription, priority=HIGH|MEDIUM|LOW, ownerName, order, outOfScope, asisFlowId, asisNodeId, tobeFlowId, tobeNodeId, issueTreeId}
- DELETE /api/gap-items/{id}  — GAP削除
- POST /api/gap-items/{id}/resolve  — GAP解決（status→RESOLVED）
- POST /api/gap-items/{id}/reopen  — GAP再オープン（status→OPEN）

### GAP分析 (8)（行一括置換オーバーレイ）
- GET/PUT /api/projects/{projectId}/analysis-pareto  — パレート分析（PUT body:{*rows}）
- GET/PUT /api/projects/{projectId}/analysis-sensitivity  — 感度分析（PUT body:{*rows}）
- GET/PUT /api/projects/{projectId}/analysis-gap  — ギャップ分析（PUT body:{*rows}）
- GET/PUT /api/projects/{projectId}/analysis-leak  — 漏れ分析（PUT body:{*rows}）

### GAP台帳 (2)
- GET /api/projects/{projectId}/gap-ledgers  — GAP台帳オーバーレイ一覧
- PUT /api/projects/{projectId}/gap-ledgers  — 行ごと UPSERT（マージ） body:{*rows}

### TOBEビジョン (4)
- GET /api/projects/{projectId}/tobe-visions  — 一覧
- POST /api/projects/{projectId}/tobe-visions  — 作成 body:{area, vision, countermeasure, effect, order, subProjectId, asisFlowId}
- PATCH /api/tobe-visions/{id}  — 更新（同上）
- DELETE /api/tobe-visions/{id}  — 削除

### TOBEロードマップ (4)
- GET /api/projects/{projectId}/tobe-roadmaps  — 一覧
- POST /api/projects/{projectId}/tobe-roadmaps  — 作成 body:{phase, measure, roi, cost, payback, scope, order, subProjectId, tobeVisionId}
- PATCH /api/tobe-roadmaps/{id}  — 更新（同上）
- DELETE /api/tobe-roadmaps/{id}  — 削除

### ロードマップフェーズ (4)
- GET /api/projects/{projectId}/roadmap-phases  — 一覧（0件なら初期3フェーズをシード）
- POST /api/projects/{projectId}/roadmap-phases  — 作成 body:{*name, order}
- PATCH /api/roadmap-phases/{id}  — 更新（改名・並べ替え） body:{name, order}
- DELETE /api/roadmap-phases/{id}  — 削除

### ASISメモ (4)
- GET /api/projects/{projectId}/asis-memos  — 一覧
- POST /api/projects/{projectId}/asis-memos  — 作成 body:{topic, currentState, pain, restriction, note, order}
- PATCH /api/asis-memos/{id}  — 更新（同上）
- DELETE /api/asis-memos/{id}  — 削除

### Requirements (11)
- GET /api/requirements/project/{projectId}  — 要求一覧
- GET /api/requirements/{id}  — 要求詳細
- PUT /api/requirements/{id}  — 要求更新 body:{title, description, type, priority, status, order}
- DELETE /api/requirements/{id}  — 要求削除
- POST /api/requirements  — 要求作成 body:{*projectId, parentId, *title, description, originalText, type, priority, status}
- POST /api/requirements/parse  — 自然言語から要求生成（AI） body:{*projectId, *text, parentId}
- POST /api/requirements/{id}/refine  — 要求詳細化（AI）
- POST /api/requirements/{id}/link-flow  — 業務フロー紐付け body:{*flowId, flowNodeId, description}
- DELETE /api/requirements/{id}/link-flow/{mappingId}  — フロー紐付け解除
- POST /api/requirements/{id}/link-crud  — CRUDマッピング紐付け body:{*crudMappingId, description}
- DELETE /api/requirements/{id}/link-crud/{mappingId}  — CRUD紐付け解除

### タスク (7)
- GET /api/projects/{projectId}/tasks  — タスク一覧（フラット tasks[] + dependencies[]）
- POST /api/projects/{projectId}/tasks  — タスク作成 body:{*title, description, parentId, status=OPEN|IN_PROGRESS|RESOLVED|CLOSED, priority=HIGH|MEDIUM|LOW, assigneeName, assigneeRoleId, issueNodeId, riskId, startDate, dueDate, progress, estimatedHours, actualHours, milestone, category, order}
- GET /api/tasks/{id}  — タスク取得
- PUT /api/tasks/{id}  — タスク更新（同上の任意フィールド）
- DELETE /api/tasks/{id}  — タスク削除（子・依存はカスケード）
- POST /api/tasks/{id}/dependencies  — 依存追加（:id を後続として predecessorId に依存） body:{*predecessorId}
- DELETE /api/tasks/dependencies/{depId}  — 依存削除

### タスクコメント (4)
- GET /api/tasks/{taskId}/comments  — コメント一覧（古い順）
- POST /api/tasks/{taskId}/comments  — コメント投稿 body:{*body}
- PUT /api/task-comments/{id}  — コメント更新 body:{*body}
- DELETE /api/task-comments/{id}  — コメント削除

### リスク・ボトルネック (4)
- GET /api/projects/{projectId}/risks  — 一覧
- POST /api/projects/{projectId}/risks  — 作成 body:{code, type, event, causeCategory, probability, impact, priority, countermeasure, needsMtg, mtgDate, deadline, owner, status, note, order, categoryId, subProjectId, ownerStakeholderId, reviewMeetingId, probabilityScore, impactScore, riskType, strategy, responsePlan, contingencyPlan, trigger, lifecycle}
- PATCH /api/risks/{id}  — 更新（同上フィールド）
- DELETE /api/risks/{id}  — 削除

### リスクカテゴリ（RBS） (4)
- GET /api/projects/{projectId}/risk-categories  — 一覧（0件なら PMBOK RBS をシード）
- POST /api/projects/{projectId}/risk-categories  — 作成 body:{*name, order}
- PATCH /api/risk-categories/{id}  — 更新（改名・並べ替え） body:{name, order}
- DELETE /api/risk-categories/{id}  — 削除（紐付くリスクは未分類化）

### ステークホルダー (6)
- GET /api/projects/{projectId}/stakeholders  — 一覧
- POST /api/projects/{projectId}/stakeholders  — 作成 body:{*name, affiliation, role, interest, concern, influence, support, engagement, reportFrequency, contactMethod, owner, reportLine, asisHearing, tobeSparring, note, side=INTERNAL|EXTERNAL, order}
- PATCH /api/stakeholders/{id}  — 更新（同上）
- DELETE /api/stakeholders/{id}  — 削除
- PUT /api/stakeholders/{id}/domain-assignments  — 担当領域（領域×RACI）全置換 body:{*items}
- GET /api/projects/{projectId}/stakeholder-assignments  — 全体の領域×RACI 割当一覧

### 会議体 (6)
- GET /api/projects/{projectId}/meetings  — 一覧（stakeholderIds含む）
- POST /api/projects/{projectId}/meetings  — 作成 body:{*name, purpose, frequency, dayTime, requiredAttendees, optionalAttendees, agendaTemplate, preMaterials, minutesOwner, format, durationMinutes, locationUrl, ownerStakeholderId, status, goal, decisionMaker, note, order}
- PATCH /api/meetings/{id}  — 更新（同上）
- DELETE /api/meetings/{id}  — 削除
- PUT /api/meetings/{id}/stakeholders  — 対象ステークホルダー置換 body:{*stakeholderIds}
- PUT /api/meetings/{id}/sub-projects  — 対象サブ領域置換 body:{*subProjectIds}

### 報告・連絡カレンダー (4)
- GET /api/projects/{projectId}/report-calendars  — 一覧
- POST /api/projects/{projectId}/report-calendars  — 作成 body:{stakeholderId, reportTo, meetingId, reportContent, frequency, dayTime, format, medium, drafter, approver, templateRef, note, order}
- PATCH /api/report-calendars/{id}  — 更新（同上）
- DELETE /api/report-calendars/{id}  — 削除

### 関心ごとマトリクス (4)
- GET /api/projects/{projectId}/interest-rows  — 一覧
- POST /api/projects/{projectId}/interest-rows  — 作成 body:{phase, duration, mainMeetings, fieldStaff, clientPm, executive, order}
- PATCH /api/interest-rows/{id}  — 更新（同上）
- DELETE /api/interest-rows/{id}  — 削除

### KPI（業務KPI・AI精度KPI） (7)
- GET /api/projects/{projectId}/kpis  — 一覧（任意フィルタ category/flowId/systemId）
- POST /api/projects/{projectId}/kpis  — 作成 body:{*name, category=BUSINESS|AI_QUALITY, flowId, systemId, description, definition, unit, baselineValue, targetValue, currentValue, direction=INCREASE|DECREASE|MAINTAIN, frequency=DAILY|WEEKLY|MONTHLY|QUARTERLY, measurementMethod, ownerRoleId, smartSpecific, smartMeasurable, smartAchievable, smartRelevant, smartTimeBound, smartComment, status=DRAFT|ACTIVE|ARCHIVED, order}
- PATCH /api/kpis/{id}  — 更新（同上の全フィールド）
- DELETE /api/kpis/{id}  — 削除
- PUT /api/kpis/{id}/information-types  — 測定対象情報種別を全置換 body:{*informationTypeIds}
- GET /api/business-flows/{flowId}/io-summary  — フロー入出力情報種別サマリ
- POST /api/projects/{projectId}/kpis/generate  — AIでKPI候補生成 body:{*category=BUSINESS|AI_QUALITY, flowId, systemId, *informationTypeIds, instructions, count}

### 導入状況 (3)
- GET /api/projects/{projectId}/adoption-statuses  — 一覧
- PUT /api/projects/{projectId}/adoption-statuses/upsert  — upsert（(projectId,stakeholderId,systemId)で一意） body:{*stakeholderId, systemId, stage=NOT_STARTED|INFORMED|TRAINED|TRIAL|LIVE|ESTABLISHED, blockers, nextAction, note, lastContactAt}
- DELETE /api/adoption-statuses/{id}  — 削除

### 変更履歴 (1)
- GET /api/projects/{projectId}/change-logs  — 変更履歴一覧（新しい順）

### Tables（データカタログ） (13)
- GET /api/tables/project/{projectId}  — テーブル一覧
- GET /api/tables/{id}  — テーブル詳細（カラム含む）
- POST /api/tables  — テーブル作成 body:{*projectId, *name, displayName, description, tags, informationTypeId}
- PUT /api/tables/{id}  — テーブル更新 body:{name, displayName, description, tags, informationTypeId}
- DELETE /api/tables/{id}  — テーブル削除
- GET /api/tables/{tableId}/columns  — カラム一覧
- POST /api/tables/{tableId}/columns  — カラム作成 body:{*name, displayName, dataType, description, isPrimaryKey, isForeignKey, isNullable, isUnique, defaultValue, foreignKeyTable, foreignKeyColumn, order}
- DELETE /api/tables/{tableId}/columns/{columnId}  — カラム削除
- GET /api/tables/{tableId}/columns/{columnId}/crud-mappings  — カラムのCRUD一覧
- POST /api/tables/crud-mappings  — CRUD作成 body:{*columnId, *operation=CREATE|READ|UPDATE|DELETE, *roleId, flowId, flowNodeId, how, condition, description}
- DELETE /api/tables/crud-mappings/{id}  — CRUD削除
- POST /api/tables/import/csv  — CSVからテーブル/カラムをインポート body:{*projectId, *csv}
- GET /api/tables/import/csv/template  — CSVテンプレート取得

### DFD（データフロー図） (15)
- GET /api/business-flows/{flowId}/dfd  — 第2レベルDFD取得（get-or-create）
- POST /api/business-flows/{flowId}/dfd  — 第2レベルDFD生成（冪等同期）
- GET /api/projects/{projectId}/dfd  — 第1レベルDFD取得（get-or-create）
- POST /api/projects/{projectId}/dfd  — 第1レベルDFD生成（冪等同期）
- POST /api/dfd-diagrams/{diagramId}/nodes  — ノード追加 body:{*kind=FUNCTION|EXTERNAL_ENTITY|DATA_STORE, *label, number, refFlowId, refNodeId, dataObjectId, positionX, positionY}
- PATCH /api/dfd-nodes/{id}  — ノード更新 body:{label, number, kind=FUNCTION|EXTERNAL_ENTITY|DATA_STORE, dataObjectId, positionX, positionY}
- DELETE /api/dfd-nodes/{id}  — ノード削除
- POST /api/dfd-diagrams/{diagramId}/flows  — データフロー追加 body:{*sourceNodeId, *targetNodeId, sourceHandle, targetHandle, dataItem, informationTypeId, pathStyle, labelT, infoT, order}
- PATCH /api/dfd-flows/{id}  — データフロー更新（同上）
- DELETE /api/dfd-flows/{id}  — データフロー削除
- PUT /api/dfd-diagrams/{diagramId}/positions  — ノード位置一括保存 body:{*positions}
- GET /api/dfd-diagrams/{diagramId}/annotations  — 注釈一覧
- POST /api/dfd-diagrams/{diagramId}/annotations  — 注釈作成 body:{kind=STICKY|COMMENT|ICON|SCOPE, width, height, color, icon, borderStyle=dashed|solid, fillOpacity, text, positionX, positionY}
- PATCH /api/dfd-annotations/{id}  — 注釈更新（同上）
- DELETE /api/dfd-annotations/{id}  — 注釈削除

### データオブジェクト（オブジェクト関係性マップ・ER図） (16)
- GET /api/projects/{projectId}/data-objects  — 関係性マップ取得（objects＋relations）
- POST /api/projects/{projectId}/data-objects  — オブジェクト作成 body:{*name, description, color, positionX, positionY, order}
- PATCH /api/data-objects/{id}  — オブジェクト更新 body:{name, description, color, order}
- DELETE /api/data-objects/{id}  — オブジェクト削除
- POST /api/projects/{projectId}/data-object-relations  — 関係線作成（source=target拒否） body:{*sourceObjectId, *targetObjectId, cardinality=ONE_TO_ONE|ONE_TO_MANY|MANY_TO_MANY, label, description, pathStyle=straight|bezier, sourceHandle=top|right|bottom|left, targetHandle=top|right|bottom|left}
- PATCH /api/data-object-relations/{id}  — 関係線更新（同上）
- DELETE /api/data-object-relations/{id}  — 関係線削除
- PUT /api/projects/{projectId}/data-objects/positions  — オブジェクト位置一括保存 body:{*positions}
- POST /api/projects/{projectId}/data-objects/import-from-dfd  — 第1レベルDFDのデータストアから取り込み（冪等）
- GET /api/projects/{projectId}/er-graph  — ER図グラフ（objects＋tables＋fkEdges＋relations）
- PUT /api/projects/{projectId}/er-positions  — ER図テーブル位置一括保存 body:{*positions}
- PUT /api/tables/{tableId}/data-object  — テーブルをオブジェクトに紐づけ/解除 body:{dataObjectId}（null で解除）
- GET /api/projects/{projectId}/data-object-annotations  — 付箋/メモ一覧
- POST /api/projects/{projectId}/data-object-annotations  — 付箋/メモ追加 body:{kind=STICKY|COMMENT, text, positionX, positionY, color, order}
- PATCH /api/data-object-annotations/{id}  — 付箋/メモ更新 body:{text, positionX, positionY, width, height, color, order}
- DELETE /api/data-object-annotations/{id}  — 付箋/メモ削除

### CRUOA情報の地図 (2)
- GET /api/business-flows/{flowId}/cruoa  — CRUOA情報の地図（列/行/セル）取得
- PUT /api/business-flows/{flowId}/cruoa  — CRUOA情報の地図を一括置換 body:{*cols, *rows, *cells}

### 添付 (13)
- POST/GET /api/projects/{projectId}/attachments  — プロジェクト直下の汎用資料（アップロード/一覧）
- POST/GET /api/projects/{projectId}/phases/{phaseId}/attachments  — フェーズ添付
- POST/GET /api/tasks/{taskId}/attachments  — タスク添付
- POST/GET /api/information-types/{informationTypeId}/attachments  — 情報種別の具体帳票
- POST/GET /api/business-flows/{flowId}/attachments  — 業務フロー添付
- GET /api/attachments/{id}/file  — 添付実体を配信（認証不要）
- PUT /api/attachments/{id}  — メタ更新 body:{caption, pageRange, order, displayName, folder}
- DELETE /api/attachments/{id}  — 添付削除
（POST のアップロードは multipart/form-data。ファイル本体はフォームフィールドで送る）

### GitHub連携 (6)
- GET /api/projects/{projectId}/github-connections  — 一覧（token非返却）
- POST /api/projects/{projectId}/github-connections  — 作成（PAT暗号化保存） body:{*repoFullName, branch, *token, autoSync, syncIntervalMinutes}
- PUT /api/github-connections/{id}  — 更新 body:{repoFullName, branch, token, autoSync, syncIntervalMinutes}
- DELETE /api/github-connections/{id}  — 削除
- POST /api/github-connections/{id}/sync  — 手動同期（取得→AI抽出→カタログ反映）
- GET /api/github-connections/{id}/runs  — 同期実行履歴（最新20）

### DB接続 (5)
- GET /api/projects/{projectId}/database-connections  — 一覧（接続文字列非返却）
- POST /api/projects/{projectId}/database-connections  — 作成（暗号化保存） body:{*name, dialect, *connString}
- PUT /api/database-connections/{id}  — 更新 body:{name, dialect, connString}
- DELETE /api/database-connections/{id}  — 削除
- POST /api/database-connections/{id}/introspect  — スキーマ取得→カタログ upsert（postgres/mysql）

### コード抽出 (11)
- GET /api/projects/{projectId}/api-endpoints  — 抽出APIエンドポイント一覧（ロール権限含む）
- PUT /api/api-endpoints/{id}  — 編集 body:{method, path, summary}
- DELETE /api/api-endpoints/{id}  — 削除
- PUT /api/api-endpoints/{id}/roles/{roleId}  — API×ロール権限 upsert body:{*allowed, note}
- PUT /api/flow-edges/{id}/api-links  — 矢印に紐づくAPIを全置換 body:{*apiEndpointIds}
- GET /api/projects/{projectId}/table-statuses  — テーブル別ステータス一覧（マトリクス用）
- POST /api/tables/{tableId}/statuses  — ステータス追加 body:{*value, label, color, order}
- PUT /api/statuses/{id}  — ステータス編集 body:{value, label, color, order}
- DELETE /api/statuses/{id}  — ステータス削除
- PUT /api/statuses/{statusId}/roles/{roleId}  — ステータス×ロール権限 upsert body:{*operations, note}
- POST /api/projects/{projectId}/catalog/analyze-schema  — スキーマテキストをAI解析してテーブル等生成 body:{*schemaText}

### 業務ドメインマスタ（仕入先/商品/需要） (各4)
- 仕入先: GET/POST /api/projects/{projectId}/suppliers, PATCH/DELETE /api/suppliers/{id}  — POST body:{code, name, salesRep, tel, email, leadTimeDays, note, order}
- 商品: GET/POST /api/projects/{projectId}/products, PATCH/DELETE /api/products/{id}  — POST body:{code, name, supplierId, supplierName, minLot, unitPrice, note, order}
- 過去需要: GET/POST /api/projects/{projectId}/demand-data, PATCH/DELETE /api/demand-data/{id}  — POST body:{productName, period, quantity, note, order}

### User Settings (4)
- GET /api/user-settings  — ユーザー設定取得
- PUT /api/user-settings/api-keys  — 外部LLM APIキー更新 body:{anthropicApiKey, openaiApiKey}
- PUT /api/user-settings/preferences  — その他設定更新 body:{settings}
- GET /api/user-settings/api-key/test  — APIキー有効性テスト

---

## メモ

- 一覧→詳細→作成→更新の順に ID を取り回す（ID をでっち上げない）。
- `*_sync` / `import-from-dfd` / `phases/initialize` / `risk-categories`（0件シード）/ `roadmap-phases`（0件シード）は冪等。
- `category`/`kind`/`status`/`direction`/`raci` などの enum は上記の候補値だけを使う。
- 「行一括置換」系（analysis-*, cruoa, gap-ledgers の PUT）は既存行を入れ替えるので、現状を GET してからマージする。
