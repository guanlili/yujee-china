ALTER TABLE "album_photos" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "album_photos" ADD CONSTRAINT "album_photos_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
