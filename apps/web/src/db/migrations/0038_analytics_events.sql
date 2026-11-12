CREATE TABLE "analytics_events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"album_id" text,
	"locale" text,
	"value" bigint,
	"result" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_analytics_name_created" ON "analytics_events" USING btree ("name","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_analytics_subject_created" ON "analytics_events" USING btree ("subject_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_analytics_created" ON "analytics_events" USING btree ("created_at");