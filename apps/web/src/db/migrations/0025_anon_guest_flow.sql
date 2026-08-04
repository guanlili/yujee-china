ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_anonymous" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "albums" ADD COLUMN IF NOT EXISTS "copy_source" text;
