-- ④ 一次性成稿(/v3/compose)改成异步 job:agent_jobs.kind 增加 'compose'。
-- 老行不受影响(枚举只加值,不改已有值)。IF NOT EXISTS 让重复执行安全。
ALTER TYPE "public"."agent_job_kind" ADD VALUE IF NOT EXISTS 'compose';
