-- 2026-10-29:feedback 表 user_id 索引。后台 feedback 列表按用户查/排序时,
-- 无索引时全表扫(user量增长后会越来越慢);user_id 已有 FK 约束但 PG 不会
-- 自动为 FK 建索引。
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback (user_id);
