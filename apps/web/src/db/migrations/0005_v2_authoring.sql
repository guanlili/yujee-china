-- v2 rebuild · authoring tree + job kind. All additive, zero impact on existing rows.
-- See docs/agent/rebuild-tech-plan.md §8.
CREATE TYPE "public"."agent_job_kind" AS ENUM('init', 'finalize');--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "kind" "agent_job_kind" DEFAULT 'init' NOT NULL;--> statement-breakpoint
ALTER TABLE "album_messages" ADD COLUMN "chapter_id" text;--> statement-breakpoint
ALTER TABLE "albums" ADD COLUMN "draft_json" jsonb;--> statement-breakpoint
-- DB backstop for "one active job per (album, kind)" (tech-plan §11 P1-7).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_agent_jobs_album_kind_active" ON "agent_jobs" USING btree ("album_id","kind") WHERE "agent_jobs"."status" in ('QUEUED', 'RUNNING');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_album_messages_album_chapter_created" ON "album_messages" USING btree ("album_id","chapter_id","created_at");
