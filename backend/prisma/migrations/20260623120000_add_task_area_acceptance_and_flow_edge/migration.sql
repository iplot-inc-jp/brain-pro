-- ガントのタスクに「達成条件(acceptance_criteria)」「領域(sub_project_id)」を追加し、
-- ノード添付の種別(DiagramNodeKind)に矢印添付用の FLOW_EDGE を追加する。
-- いずれも追加のみの非破壊変更（IF NOT EXISTS）で冪等。
-- 本番/ローカル DB へは `npx prisma migrate deploy`（または `npx prisma db push`）で適用すること。
--
-- ⚠️ 適用順の注意: 再生成済み Prisma Client は Task.save 時に acceptance_criteria /
-- sub_project_id を無条件で書き込むため、このマイグレーションを適用する前に新 backend を
-- デプロイすると、全タスク保存が P2022 (column does not exist) で失敗する。
-- 必ず「DB マイグレーション → backend デプロイ → frontend デプロイ」の順で行うこと。

-- 矢印(FlowEdge)への画像/ファイル添付を許可する種別。
ALTER TYPE "DiagramNodeKind" ADD VALUE IF NOT EXISTS 'FLOW_EDGE';

-- タスクの達成条件（自由記述）と領域（SubProject）への紐付け。
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "acceptance_criteria" TEXT;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "sub_project_id" TEXT;

-- 領域への外部キー（領域が消えても task は残す = SET NULL）。再適用できるよう一旦 DROP。
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_sub_project_id_fkey";
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sub_project_id_fkey"
  FOREIGN KEY ("sub_project_id") REFERENCES "sub_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
