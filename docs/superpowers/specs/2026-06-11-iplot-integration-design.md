# IPLoT 整合性統合 設計（共通マスタ × 領域 × ASIS/TOBE）

- 日付: 2026-06-11
- ブランチ: feat/methodology-pipeline
- 状態: 設計合意中（4論点はユーザ回答済み、制約条件を追記）

## 背景・課題

機能をバラバラに作ってきたため、同じ概念が複数箇所に分散し整合性が取れていない。
特に「INPUT/OUTPUT」「ロール／システム」「制約条件」「領域」が ASIS/TOBE/課題ツリーで
共有されておらず、TOBE 側に存在しない概念もある。これを共通マスタへ一元化する。

## 決定事項（ユーザ回答）

1. **領域 = SubProject**。既存のサブプロジェクトを「領域」として活用し、サブ領域はその入れ子
   （領域 → サブ領域 → フロー）。新しいグルーピング軸は増やさない。
2. **INPUT/OUTPUT は情報リンクを正**にする。InformationType マスタが唯一の真実。業務定義の
   INPUT/OUTPUT はノードの情報リンクから自動集計表示し、冗長な `inputDetail` 等は削除。
3. **システムは System 新マスタ**（周辺／対象を区別）。サイドメニューで管理、SYSTEM ロールが参照。
4. **ASIS/TOBE は共通マスタ共有**。領域・ロール・システム・INPUT/OUTPUT・制約条件を1セットで共有。
   TOBE は ASIS から複製改変も新規作成も可。サイドメニューで ASIS/TOBE を隣接配置。
5. **制約条件も共通マスタ**（ASIS/TOBE 共有）にし、領域に紐づけられるようにする（本設計で追加）。

## 共通マスタモデル（すべて 領域=SubProject に任意で紐づく）

「領域に紐づける？」への回答: **任意紐付け**。各マスタは projectId 必須＋ subProjectId（領域）任意。
領域未指定＝プロジェクト全体で共有、領域指定＝その領域に属する、の二段で運用できる。

| 概念 | モデル | 主フィールド | 紐付け |
|---|---|---|---|
| 領域／サブ領域 | `SubProject`（既存・拡張） | name, `parentId`(サブ領域用に追加) | self（領域→サブ領域） |
| ロール | `Role`（既存） | type(HUMAN/SYSTEM/OTHER), `systemId`(追加), `subProjectId`(追加) | System, 領域 |
| システム | `System`（新規） | name, kind(PERIPHERAL/TARGET), subProjectId | 領域 |
| INPUT/OUTPUT | `InformationType`（既存） | name, category(情報/物体/帳票), `subProjectId`(追加) | 領域、Table(1:N) |
| 制約条件 | `Constraint`（新規） | title, description, kind?, subProjectId | 領域 |
| カタログ表 | `Table`（既存） | `informationTypeId`(追加) | InformationType(N:1) |

- **Table ↔ InformationType は 1:N**（InformationType 1 — Table N）。`Table.informationTypeId String?`。
- **Role(SYSTEM) ↔ System**: `Role.systemId String?`。type=SYSTEM のとき System を参照しレーンに反映。
- 既存の `AsisMemo.restriction`（フリーテキスト制約）と `RequirementType.CONSTRAINT` はそのまま残し、
  新 `Constraint` マスタとは段階移行（まず新マスタを追加、UI で参照させる。破壊的移行はしない）。

## サイドメニュー再編

現状の並びを、共通マスタ → ASIS → TOBE の流れに整理する。
- 「ASIS管理」の隣に「TOBE管理」を配置。
- 新規ナビ: 「領域」「INPUT/OUTPUT」「システム」「制約条件」（プロジェクト共通マスタ群）。
- これら管理ページは既存の `InformationTypeRegistry`（DFD 内の情報種別 CRUD）と同じ作法の
  一覧＋インライン編集＋作成ダイアログで実装し、領域フィルタを付ける。

## 実装ウェーブ（順次・各ウェーブ後に db push + 再起動 + ライブ確認 + commit）

- **Wave 2a（スキーマ＋バックエンド基盤）**: `System`/`Constraint` 追加、`Role.systemId`/`Role.subProjectId`、
  `InformationType.subProjectId`、`Table.informationTypeId`、`SubProject.parentId`（サブ領域）。
  各 CRUD エンドポイント。prisma generate（ワークフロー）→ db push（オーケストレータ）。
- **Wave 2b（サイドメニュー＋共通マスタ管理ページ）**: ナビ再編、領域/INPUT-OUTPUT/システム/制約条件の管理ページ、
  カタログ表に「INPUT/OUTPUT 紐付け」UI、ロールに人/システム＋System 選択。
- **Wave 3（フロー編集統合）**: 業務定義 IN/OUT をノード情報リンクから自動集計（inputDetail 削除）、
  ロールを人/システムでアイコン区別＋フロー途中で追加、縦横切替を座標変換（手動配置を保持）、付箋／コメント。
- **Wave 4（課題ツリー＋TOBE）**: 親ノード種別による子種別の制限マトリクス、TOBE「あるべき姿」追加＋領域選択
  （ASIS と同じ領域を選べる）。

## 非ゴール（YAGNI）

- 既存 ASIS データ（AsisMemo.restriction 等）の自動マイグレーションは行わない（新マスタ併設）。
- 共通マスタの組織横断共有は対象外（プロジェクト単位＋領域単位まで）。
- N:M（Table↔InformationType の多対多）は採らない（ユーザ決定の 1:N）。

## 検証方針

各ウェーブで backend/frontend tsc 0・vitest 維持、db push 後にバックエンド再起動＋ライブ smoke
（新マスタ CRUD、紐付け、ASIS/TOBE での共有表示）、commit。
