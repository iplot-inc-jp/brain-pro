-- AlterTable: タスクに GAP（課題）への任意リンクを追加
ALTER TABLE "tasks" ADD COLUMN "gap_item_id" TEXT;

-- AddForeignKey: GAP が消えても task は残す（SetNull）
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_gap_item_id_fkey" FOREIGN KEY ("gap_item_id") REFERENCES "gap_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
