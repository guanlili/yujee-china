DROP INDEX IF EXISTS "idx_album_messages_album_created";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_album_messages_album_chapter_created";--> statement-breakpoint
ALTER TABLE "album_messages" ADD COLUMN "seq" integer;--> statement-breakpoint
UPDATE "album_messages" AS m SET "seq" = t.rn FROM (
  SELECT "id", row_number() OVER (PARTITION BY "album_id" ORDER BY "created_at", "id") AS rn
  FROM "album_messages"
) AS t WHERE m."id" = t."id";--> statement-breakpoint
ALTER TABLE "album_messages" ALTER COLUMN "seq" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_album_messages_album_seq" ON "album_messages" USING btree ("album_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_album_messages_album_chapter_seq" ON "album_messages" USING btree ("album_id","chapter_id","seq");
