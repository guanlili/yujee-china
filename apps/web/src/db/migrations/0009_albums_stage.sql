CREATE TYPE "public"."album_stage" AS ENUM('analysing', 'story', 'theme', 'cover', 'ready');--> statement-breakpoint
ALTER TABLE "albums" ADD COLUMN "stage" "album_stage" DEFAULT 'analysing' NOT NULL;--> statement-breakpoint
-- Backfill existing rows (architecture §6.8 第 4 条). The ADD COLUMN default already
-- set every row to 'analysing', which is correct for AGENT_RUNNING (and FAILED);
-- only finished books move to 'ready'. `status` is untouched — the two columns are
-- orthogonal and independently written.
UPDATE "albums" SET "stage" = 'ready' WHERE "status" IN ('COMPLETED', 'EDITING');