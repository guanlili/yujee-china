CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "provider" "customer_provider" NOT NULL,
  "external_customer_id" text,
  "external_subscription_id" text NOT NULL,
  "plan_id" text NOT NULL,
  "billing_cycle" text NOT NULL,
  "status" text NOT NULL,
  "current_period_start" timestamp with time zone NOT NULL,
  "current_period_end" timestamp with time zone NOT NULL,
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subscriptions_user_period_end" ON "subscriptions" USING btree ("user_id","current_period_end" DESC NULLS LAST);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_subscriptions_provider_external" ON "subscriptions" USING btree ("provider","external_subscription_id");
