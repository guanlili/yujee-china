-- 计费重定价 (2026-07-17): 1 积分 = 20 张照片 → 1 积分 = 1 张照片。
-- 单位缩小 20 倍,存量必须全部 ×20 才能保持购买力与账本自洽:
--   * users.credit_balance           当前可用余额
--   * credit_ledger.delta / balance_after  历史流水与其运行余额 (余额 = Σdelta = 最后 balance_after)
--   * credit_holds.amount            未结算/已结算的持有额 (可用 = 余额 − HOLDING 持有)
-- 不 ×20 其中任一张,展示/可用余额就会算错。
--
-- ⚠️ 非幂等: 重复执行 = ×400。靠 drizzle 迁移一次性执行 (_journal.json 记录) 保证;
--    切勿在生产手动重跑本文件。
UPDATE "users" SET "credit_balance" = "credit_balance" * 20;
--> statement-breakpoint
UPDATE "credit_ledger" SET "delta" = "delta" * 20, "balance_after" = "balance_after" * 20;
--> statement-breakpoint
UPDATE "credit_holds" SET "amount" = "amount" * 20;
--> statement-breakpoint
-- 列默认值对齐新赠送量 (FREE_PLAN_CREDITS = 20;旧默认 100 是遗留、且与赠送量不一致)。
ALTER TABLE "users" ALTER COLUMN "credit_balance" SET DEFAULT 20;
