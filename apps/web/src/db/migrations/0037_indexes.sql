-- 查询路径补索引;全部 CREATE INDEX IF NOT EXISTS,幂等可重跑。
-- 表/列均在 apps/web/src/db/schema.ts 核实存在:
--   credit_ledger.related_album_id / related_hold_id  (schema.ts:626-631)
--   verifications(identifier, value)                  (schema.ts:172-173)
--   sessions.expires_at                               (schema.ts:134)
-- 索引命名沿用现有 idx_<表>_<列> 风格(对照 0000 的 idx_credit_ledger_user_created
-- / idx_sessions_user),不与既有索引重名。
CREATE INDEX IF NOT EXISTS "idx_credit_ledger_related_album_id" ON "credit_ledger" USING btree ("related_album_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_credit_ledger_related_hold_id" ON "credit_ledger" USING btree ("related_hold_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_verifications_identifier_value" ON "verifications" USING btree ("identifier","value");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessions_expires_at" ON "sessions" USING btree ("expires_at");
