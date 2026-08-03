CREATE TABLE IF NOT EXISTS "draft_pages" (
	"album_id" text NOT NULL,
	"page_index" integer NOT NULL,
	"page" jsonb NOT NULL,
	"version" bigint NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_pages_album_id_page_index_pk" PRIMARY KEY("album_id","page_index")
);
--> statement-breakpoint
ALTER TABLE "albums" ADD COLUMN "draft_revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "draft_pages" ADD CONSTRAINT "draft_pages_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
