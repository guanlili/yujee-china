-- B4 · payment + ledger idempotency
-- 1. Extend credit_ledger_reason enum with HOLD / RELEASE so credit
--    reservations and releases leave an auditable trail next to SETTLE.
-- 2. Add a partial UNIQUE index on credit_ledger((meta->>'external_event_id'))
--    so the same provider webhook event can never insert two PURCHASE rows.
--    Partial: only enforced when the key is present (internal entries like
--    GENERATION_SETTLE leave meta NULL and stay unconstrained).

ALTER TYPE "public"."credit_ledger_reason" ADD VALUE IF NOT EXISTS 'GENERATION_HOLD';--> statement-breakpoint
ALTER TYPE "public"."credit_ledger_reason" ADD VALUE IF NOT EXISTS 'GENERATION_RELEASE';--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_credit_ledger_external_event"
  ON "credit_ledger" (("meta"->>'external_event_id'))
  WHERE "meta"->>'external_event_id' IS NOT NULL;
