-- Backfill:补齐 credit_ledger.reason 枚举值 GENERATION_HOLD / GENERATION_RELEASE。
-- 依据(均已核实,非猜测):
--   * 枚举真实类型名 = "credit_ledger_reason"(apps/web/src/db/schema.ts:78
--     pgEnum('credit_ledger_reason', [...]),0000_chubby_bucky.sql:4 建类型),
--     不是列名 reason。
--   * 0000 建枚举时只有 SIGNUP_BONUS/GENERATION_SETTLE/PURCHASE/REFUND/
--     ADMIN_ADJUST;GENERATION_HOLD/GENERATION_RELEASE 由
--     0001_b4_billing.sql:9-10 以 ADD VALUE IF NOT EXISTS 补入。prod 库早已
--     持有这两个值(schema.ts 枚举含之;0002 注释证实这是历史 snapshot drift)。
--   * 本迁移是防御性 backfill:任何迁移史与 prod 不一致的环境(旧快照恢复、
--     手工库、只 restore 了 dump 的库)都能补齐;ADD VALUE IF NOT EXISTS 在值已
--     存在时是 no-op,可安全重跑。
-- 事务说明:drizzle-orm@0.45.4 pg 方言(pg-core/dialect.js:60)把本次待执行的
-- 全部迁移包在同一个 session.transaction 里执行,drizzle-kit@0.31 配置项没有
-- 逐迁移关闭事务的开关;PostgreSQL 12+ 允许 ALTER TYPE ... ADD VALUE 在事务块内
-- 运行(限制仅是同一事务内不能「使用」新枚举值——本文件只加值、不引用),
-- postgres:16 实测 0000-0037 全量 apply 成功且复跑幂等,故按普通语句写,
-- 不拆事务、不加 COMMIT。
ALTER TYPE "public"."credit_ledger_reason" ADD VALUE IF NOT EXISTS 'GENERATION_HOLD';--> statement-breakpoint
ALTER TYPE "public"."credit_ledger_reason" ADD VALUE IF NOT EXISTS 'GENERATION_RELEASE';
