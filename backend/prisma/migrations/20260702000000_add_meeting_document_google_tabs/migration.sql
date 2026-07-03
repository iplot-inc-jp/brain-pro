-- ミーティングドキュメント（GOOGLE_DOC）に Google 側のタブ構成キャッシュを追加する。
-- Docs のドキュメントタブ / Sheets のシートタブをサイドメニューの第3階層に出すために、
-- Docs API / Sheets API から取得した一覧を JSON で保存する（本文は含まない）。
-- 追加のみの非破壊変更（IF NOT EXISTS）で冪等。
-- 本番/ローカル DB へは `npx prisma migrate deploy`（または `pnpm db:migrate`）で適用すること。

ALTER TABLE "meeting_documents" ADD COLUMN IF NOT EXISTS "google_tabs_json" JSONB;
ALTER TABLE "meeting_documents" ADD COLUMN IF NOT EXISTS "google_tabs_at" TIMESTAMP(3);
