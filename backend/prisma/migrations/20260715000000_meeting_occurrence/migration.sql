-- 実会議（MeetingOccurrence）: 会議帯(Meeting)の「1回分の開催実体」。議事録本文・決定事項・
-- ネクストアクション・出典を持つ。meeting_id で会議帯に紐づくのが基本。単発/例外会議は meeting_id=null。
CREATE TABLE "meeting_occurrences" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "meeting_id" TEXT,
    "title" TEXT NOT NULL,
    "held_at" TIMESTAMP(3),
    "attendees" TEXT,
    "agenda" TEXT,
    "minutes" TEXT,
    "decisions" TEXT,
    "next_actions" TEXT,
    "source" TEXT,
    "source_ref" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "meeting_occurrences_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "meeting_occurrences_project_id_idx" ON "meeting_occurrences"("project_id");
CREATE INDEX "meeting_occurrences_meeting_id_idx" ON "meeting_occurrences"("meeting_id");

ALTER TABLE "meeting_occurrences" ADD CONSTRAINT "meeting_occurrences_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_occurrences" ADD CONSTRAINT "meeting_occurrences_meeting_id_fkey"
    FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
