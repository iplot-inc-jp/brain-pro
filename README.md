# DataFlow (brain-pro)

データカタログと業務フローを紐づける統合プラットフォーム

## 思想 — 「組織の脳」を作る（brain-pro × ipro-bot × 社内教育）

> エコシステム全体の設計思想。ipro-bot リポジトリの README にも同じ節があり、いつでも参照できる。

### 背景課題: 組織知の空洞化

かつてのグローバル化は製造能力の外部化＝**産業の空洞化**を招いた。AI時代に外部化されるのは**組織知**である。
汎用AI（ChatGPT / Gemini / Claude）をただ使うだけでは、企業固有の知識・判断・ノウハウが外部AIに依存・均質化し、組織に学習が残らない。
本質的な課題は「AIを使うか否か」ではなく、**使った結果として"組織に学習が残るか"**。

### 解: 3層の組織脳

| 層 | 担うもの | 実体 |
|---|---|---|
| **構造**（どう整理するか） | プロジェクト推進上流の情報の構造化 | **brain-pro**（業務フロー・DFD・イシューツリー・GAP・KPI・要求定義…）。※「外部の脳」は汎用ワークスペースであり、会社によってはスプレッドシートや自社ツールに差し替え可能 |
| **知識**（何を知っているか） | IPLoT流コンサル方法論 | **社内教育資料（22講座）**。原型は過去プロジェクトデータの蓄積（brain-pro）×人間の抽象化能力。skill(method.md) としてプロンプト化され、ipro-bot のプロンプト管理DBで編集・版管理される |
| **実行体**（どう動くか） | 日々の業務でのAI実行 | **ipro-bot**。agent がプロンプトDBから適切な知識（頭脳）を選択して応答・成果物生成。外部ワークスペースへの保存もプロンプト制御の agent が MCP/API を判断して行う |

### 学習ループ（競争優位の源泉）

```
プロジェクト実行(ipro-bot) → 構造化して蓄積(brain-pro) → 人間が抽象化 → 教育資料(22講座)を更新
   ↑                                                                    ↓
   └────────── 頭脳（プロンプトDB）が賢くなる ←──── skill化・プロンプト化 ────┘
```

使うほど組織知が蓄積され、品質・スピードが向上する（個人の生産性向上 → チームでの活用標準化 → PJナレッジの蓄積 → 組織のAI学習ループ）。

### 応用

- **人事評価**: 教育資料（=会社の期待スキル体系）を軸に評価できる
- **採用時テスト**: 同じ体系で採用時の実技テストを設計できる
- **プロジェクトノウハウの蓄積**: 案件ごとの構造化データがそのまま次案件の資産になる

### 汎用性の原則

- ipro-bot は**特定ツールに依存しない汎用データ構造**を保つ（brain-pro 特化のハードコードはしない）
- 外部の脳（ワークスペース）は差し替え可能: brain-pro / スプレッドシート / 顧客の自社ツール
- 知識の選択・外部への格納方針は**すべてDB管理プロンプトで制御**し、コード変更なしで運用調整できる
- brain-pro 側から見た連携: AI呼び出しは組織設定で ipro-bot AIゲートウェイ経由に切替可能（`docs/superpowers/specs/2026-07-11-ipro-bot-ai-gateway-design.md`）

**ゴールは品質の向上。** この3層と学習ループが会社の競争優位性を維持する。

## 概要

DataFlowは、システムの全体像をAIと人間の両方が即座に理解できるようにするためのツールです。

### 主な機能

- **データカタログ**: テーブル・カラムのメタデータを一元管理
- **業務フローエディタ**: 直感的なUIで業務プロセスを可視化
- **CRUDマッピング**: 各カラムに対するCRUD操作とロールを紐づけ
- **mermaidエクスポート**: AIエージェント向けに構造化されたコンテキストを出力

### ユースケース

- **エンジニア**: AIエージェントにシステム全体像を渡して開発支援
- **マーケター**: 自然言語でSQLクエリを生成
- **PM/BA**: 業務フローの整理と顧客とのすり合わせ
- **AIエージェント**: 構造化されたシステム情報へのアクセス

## 技術スタック

- **フロントエンド**: Next.js 14, React Flow, Tailwind CSS, shadcn/ui
- **バックエンド**: NestJS, Prisma, PostgreSQL
- **インフラ**: Docker, Docker Compose

## 開発環境のセットアップ

### 前提条件

- Node.js 18以上
- pnpm 8以上
- Docker & Docker Compose

### 1. リポジトリのクローン

```bash
git clone <repository-url>
cd ai_data_flow
```

### 2. 依存関係のインストール

```bash
pnpm install
```

### 3. 環境変数の設定

```bash
# バックエンド
cp backend/.env.example backend/.env
```

### 4. データベースの起動

```bash
# PostgreSQLをDockerで起動
pnpm docker:up
```

### 5. データベースのマイグレーション

```bash
# Prismaマイグレーション実行
pnpm db:migrate
```

### 6. 開発サーバーの起動

```bash
# フロントエンドとバックエンドを同時起動
pnpm dev
```

- フロントエンド: http://localhost:3003
- バックエンド: http://localhost:5021
- API ドキュメント: http://localhost:5021/api/docs

### 7. シードデータの投入（任意）

```bash
pnpm db:seed
```

## 🔐 ログイン情報（開発用）

シードデータを投入すると、以下のアカウントでログインできます。

| ロール | メールアドレス | パスワード |
|--------|---------------|-----------|
| **管理者** | `admin@example.com` | `password123` |
| 開発者 | `dev@example.com` | `password123` |

> ⚠️ 本番環境では必ず別のアカウントを作成してください。

### シードデータに含まれるもの

| カテゴリ | 内容 |
|---------|------|
| 組織 | デモ株式会社 (`demo-company`) |
| プロジェクト | ECサイト (`ec-site`) |
| ロール | 顧客、管理者、決済システム、在庫管理システム |
| テーブル | users, orders, products（カラム定義付き） |
| 業務フロー | 注文処理フロー（9ノード、8エッジ） |

## プロジェクト構成

```
ai_data_flow/
├── docs/                    # 設計書
│   ├── 01-requirements.md   # 要件定義書
│   ├── 02-architecture.md   # アーキテクチャ設計書
│   ├── 03-data-model.md     # データモデル設計書
│   ├── 04-api-spec.md       # API設計書
│   ├── 05-screen-design.md  # 画面設計書
│   └── 06-business-flow.md  # 業務フロー図
│
├── frontend/                # Next.js フロントエンド
├── backend/                 # NestJS バックエンド
├── shared/                  # 共有型定義
│
├── package.json             # ルートpackage.json
└── pnpm-workspace.yaml      # pnpmワークスペース設定
```

## 主要なスクリプト

```bash
# 開発サーバー起動
pnpm dev              # 全て起動
pnpm dev:frontend     # フロントエンドのみ
pnpm dev:backend      # バックエンドのみ

# ビルド
pnpm build            # 全てビルド
pnpm build:frontend   # フロントエンドのみ
pnpm build:backend    # バックエンドのみ

# Docker
pnpm docker:up        # PostgreSQL起動
pnpm docker:down      # PostgreSQL停止
pnpm docker:logs      # ログ表示

# データベース
pnpm db:migrate       # マイグレーション実行
pnpm db:generate      # Prisma Client生成
pnpm db:studio        # Prisma Studio起動
pnpm db:seed          # シードデータ投入
pnpm db:reset         # DBリセット＋シード
```

## API エンドポイント

主要なエンドポイント:

| メソッド | パス | 説明 |
|---------|------|------|
| POST | /api/auth/register | ユーザー登録 |
| POST | /api/auth/login | ログイン |
| GET | /api/organizations | 組織一覧 |
| GET | /api/projects | プロジェクト一覧 |
| GET | /api/tables | テーブル一覧 |
| GET | /api/flows | 業務フロー一覧 |
| GET | /api/roles | ロール一覧 |
| GET | /api/export/project/:id/ai | AI向けエクスポート |

詳細は [API設計書](./docs/04-api-spec.md) を参照してください。

## ドキュメント

- [要件定義書](./docs/01-requirements.md)
- [アーキテクチャ設計書](./docs/02-architecture.md)
- [データモデル設計書](./docs/03-data-model.md)
- [API設計書](./docs/04-api-spec.md)
- [画面設計書](./docs/05-screen-design.md)
- [業務フロー図](./docs/06-business-flow.md)

## ライセンス

MIT

