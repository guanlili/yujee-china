-- ④ 一次性成稿(/v3/compose)改成异步 job:agent_jobs.kind 增加 'compose'。
-- 老行不受影响(枚举只加值,不改已有值)。IF NOT EXISTS 让重复执行安全。
-- ⚠️ PG 不允许在**同一个事务里使用**刚加的枚举值,而 drizzle 把所有待跑迁移放进同一个
-- 事务:任何引用 'compose' 的迁移(写数据、加带该值的约束/索引/默认值)必须与本文件
-- 分批部署 —— 本文件先单独跑完提交,下一批再跑用到 'compose' 的迁移。
ALTER TYPE "public"."agent_job_kind" ADD VALUE IF NOT EXISTS 'compose';
