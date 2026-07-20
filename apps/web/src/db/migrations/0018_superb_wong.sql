ALTER TYPE "public"."credit_ledger_reason" ADD VALUE 'INVITE_REDEEM';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invite_codes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"credits" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_redemptions" integer,
	"redeemed_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invite_redemptions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_code_id_invite_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."invite_codes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_invite_codes_code" ON "invite_codes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_invite_redemptions_code_user" ON "invite_redemptions" USING btree ("code_id","user_id");--> statement-breakpoint
-- 种子邀请码:共享码(每人限一次),每码 100 积分,自部署起 14 天有效。ON CONFLICT 保证幂等。
INSERT INTO "invite_codes" ("code","credits","expires_at","active") VALUES
  ('YUJEE-K7M3QP', 100, now() + interval '14 days', true),
  ('YUJEE-R9XT4B', 100, now() + interval '14 days', true),
  ('YUJEE-H2WN8D', 100, now() + interval '14 days', true),
  ('YUJEE-P5VK6J', 100, now() + interval '14 days', true),
  ('YUJEE-T8QM2R', 100, now() + interval '14 days', true),
  ('YUJEE-N4HB7X', 100, now() + interval '14 days', true),
  ('YUJEE-W6JP3K', 100, now() + interval '14 days', true),
  ('YUJEE-D9RT5M', 100, now() + interval '14 days', true)
ON CONFLICT ("code") DO NOTHING;