# 統合イシューツリー（課題→なぜ→打ち手を1本で）設計

- 日付: 2026-06-09
- ブランチ: feat/methodology-pipeline
- 状態: 設計合意済み（実装は走行中ワークフロー wg0prtcds 完了後に着手）

## 背景・課題

現在のイシューツリーは作成時に **型（WHY=なぜ型 / SOLUTION=打ち手型）** を必須選択させ、なぜ掘り下げの木と打ち手の木を別々に作る。しかし実務では「なぜ？で根本原因を掘り下げ、確定した原因にそのまま打ち手をぶら下げる」流れが普通で、1本のツリーに**なぜも打ち手も混在**するのが自然。さらに現状、作成ダイアログから作成すると「エラーが発生しました」になり作成自体ができない。

スキーマは既に統合に必要な要素を備えている（後述）。よって新規テーブルは不要で、**UI/UX とノード種別運用の再設計**が中心。

## ゴール

- 作成時の「型」選択を廃止し、**常に1本の統合ツリー**を作る。
- ノード種別 `kind`（ISSUE/CAUSE/COUNTERMEASURE）で「課題 / なぜ・原因 / 打ち手」を表現し、**種別連動のガイド付き**で作り進める。
- 方法論（課題→なぜ→確定原因→打ち手）を **ガイドするが強制はしない**。
- 現状の作成エラーを解消する。

## 非ゴール（YAGNI）

- WHY/SOLUTION の2画面運用・別ツリー間リンク（rootCauseNodeId）の新規活用はしない。
- ノード文法のハード強制（種別ごとの配置制限のバリデーション）はしない。
- スキーマ破壊的変更（型列の削除等）はしない。

## データモデル（既存を活用・新規テーブルなし）

- `IssueTree.type`(WHY/SOLUTION): **UI から外す**。DB互換のため列は残置（既定 WHY）。一覧・作成で type による分類/選択をやめる。
- `IssueNode.kind`: **ISSUE(課題) / CAUSE(なぜ・原因) / COUNTERMEASURE(打ち手)** が主役。
- `IssueNode.verification`(○CONFIRMED/×REJECTED/△UNKNOWN/NEEDS_HEARING/NA) + `evidence`: CAUSE で使用。
- `IssueNode.recommendation`(ADOPT採用/HOLD保留/REJECT不採用/NA): COUNTERMEASURE で使用。
- `IssueNode.rootCauseNodeId`: 1本に統合するため新規では使わない（打ち手は確定原因の親子で表現）。列は残置。
- `IssueTree.gapItems` / `GapItem.issueTreeId`: GAP起点リンクは維持。

## 作成フロー（型なし）

作成ダイアログ項目:
1. ツリー名（必須）
2. ルートの問い（任意）
3. GAP起点（任意・既存どおり）

挙動:
- 作成時に **ルートノードを `kind=ISSUE` で自動生成**（ラベル = ルートの問い、空ならツリー名）。
- バックエンドへ送る `type` は廃止（または常に WHY 固定で送る）。**現状の作成エラーの根本原因を実装時に特定して除去**（型必須バリデーション or ルートノード生成不整合の疑い）。

## 作り進め方（種別連動ガイド）＋ ノード文法

ノード選択時、その `kind` に応じた追加アクションを出す:

- **ISSUE 選択** → 「なぜ？（原因を追加）」= CAUSE 子生成 / 「打ち手を追加」= COUNTERMEASURE 子生成（飛ばしも可）
- **CAUSE 選択** → 「さらに なぜ？」= CAUSE 子 / 「打ち手を追加」= COUNTERMEASURE 子。`verification=CONFIRMED(○)` のとき「打ち手を追加」を**強調**。
- **COUNTERMEASURE 選択** → 「下位の打ち手」= COUNTERMEASURE 子 / 「タスク化」= 既存 Task 連携（Task.issueNodeId）
- どのノードも `kind` を**後から変更可**（取り違え救済）。配置の**強制はしない**（課題直下に打ち手も可）。

## 種別ごとの仕掛け（UI 工夫）

- 色分け: ISSUE=ネイビー(#050f3e系) / CAUSE=アンバー / COUNTERMEASURE=エメラルド。
- CAUSE ノード: ○×△/要ヒアリング バッジ + 根拠(evidence)メモ。○確定で枠を確定色にし「打ち手を追加」へ誘導。
- COUNTERMEASURE ノード: 採用/保留/不採用 バッジ。採用はタスク化導線を強調。
- 未確認(△/要ヒアリング)の原因は淡色で表示し、ヒアリングへの示唆を出す。

## 発想アシスト / AI 連携（既存を接続）

- 既存「発想法で分解」(`frontend/src/lib/ideation-methods.ts` + components/issue-trees/ideation-assist-dialog) を CAUSE/COUNTERMEASURE 候補生成に接続。
- 任意（鍵がある時のみ、既存 ClaudeService）: 「この課題のなぜ候補」「この確定原因の打ち手候補」を生成して子ノード候補に。鍵未設定時はガイド付き手動のみ。

## 既存データ移行

- 既存 WHY ツリー: そのまま（root を ISSUE 相当として扱う）。
- 既存 SOLUTION ツリー: root を ISSUE 扱いにし、打ち手をその下にぶら下げる。破壊はせずベストエフォート。
- マイグレーションスクリプトは不要（kind 既定 + 表示ロジックで吸収）。

## 影響範囲（想定ファイル）

- frontend: `issue-trees/page.tsx`（作成ダイアログから型削除・一覧の型分類削除）、`issue-trees/[treeId]/page.tsx`（種別連動の追加ボタン・色分け・○×△/採用バッジ・確定→打ち手誘導）、`lib`（issue-tree API/型）。
- backend: create-issue-tree（type 必須を緩和 + ルートノード ISSUE 自動生成、作成エラー除去）、issue-node 作成 API（kind/verification/recommendation はノードごと既存）。
- 既存の per-node 安定 API（add/update/delete）を活用。スキーマ変更なし。

## 検証

- backend tsc 0 / frontend tsc 0 / 既存 vitest 維持。
- ライブ smoke: 型なしで作成 200（ルート ISSUE 自動生成）、CAUSE 追加 → verification 設定、COUNTERMEASURE 追加 → recommendation 設定、各 per-node API 200。
- 旧データ（既存ツリー）が壊れず開けること。

## 実装タイミング

走行中ワークフロー `wg0prtcds`（issue-tree を含む）完了・コミット後に、本 spec を writing-plans → 実装。
