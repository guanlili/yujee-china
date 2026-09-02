DROP INDEX IF EXISTS "uq_album_shares_album";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_album_shares_album" ON "album_shares" USING btree ("album_id","created_at");