-- Supports findLatestByAlbum: the album-uuid read path looks up the newest job
-- per album on every 15s poll while AGENT_RUNNING (issue #48, docs/web/api.md §3.4).
CREATE INDEX IF NOT EXISTS "idx_agent_jobs_album_created" ON "agent_jobs" USING btree ("album_id","created_at" DESC NULLS LAST);
-- NOTE: drizzle-kit also wanted to ADD VALUE 'GENERATION_HOLD'/'GENERATION_RELEASE'
-- to credit_ledger_reason here — pre-existing snapshot drift (those enum values are
-- in schema.ts + production but were never recorded in a migration). Deliberately
-- omitted: ALTER TYPE ... ADD VALUE can't run in a tx and errors where the value
-- already exists (it does, in prod). The 0002 snapshot captures them as baseline so
-- future `generate` won't re-emit. Fixing the from-scratch enum gap is a separate
-- follow-up, out of scope for #48.
