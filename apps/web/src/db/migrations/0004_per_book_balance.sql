-- Per-book billing (#97): one internal credit unit now means one book.
-- Convert existing balances from the old 200-credits-per-book scale to books.
-- Postgres integer division floors, so 1000 -> 5, 350 -> 1, 199 -> 0.
-- Column names and the credit_* identifiers are intentionally kept.

UPDATE "users" SET "credit_balance" = "credit_balance" / 200;--> statement-breakpoint

-- HOLDING reservations are still denominated in old credits; rescale them too so
-- a release/settle after the migration moves the right number of books.
UPDATE "credit_holds" SET "amount" = "amount" / 200 WHERE "status" = 'HOLDING';
