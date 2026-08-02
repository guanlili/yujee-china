CREATE TYPE "public"."album_photo_status" AS ENUM('uploaded', 'missing');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "album_photos" (
	"album_id" text NOT NULL,
	"photo_id" text NOT NULL,
	"status" "album_photo_status" DEFAULT 'uploaded' NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "album_photos_album_id_photo_id_pk" PRIMARY KEY("album_id","photo_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "album_photos" ADD CONSTRAINT "album_photos_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
