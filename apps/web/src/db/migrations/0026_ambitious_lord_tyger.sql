-- 只建 image_generations。生成时 drizzle 账本漂移多吐了 albums.copy_source /
-- users.is_anonymous 两条 ADD COLUMN,那两列 0025 已经加过、库里也在,
-- 原样进生产会让构建期的 db:migrate 直接失败,已删。
CREATE TABLE IF NOT EXISTS "image_generations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"album_id" text NOT NULL,
	"user_id" text NOT NULL,
	"photo_id" text NOT NULL,
	"prompt" text NOT NULL,
	"provider" text NOT NULL,
	"free_retries_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "image_generations" ADD CONSTRAINT "image_generations_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "image_generations" ADD CONSTRAINT "image_generations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_image_generations_album_created" ON "image_generations" USING btree ("album_id","created_at" DESC NULLS LAST);