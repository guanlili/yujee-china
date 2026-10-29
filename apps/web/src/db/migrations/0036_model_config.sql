-- 2026-10-30:模型配置覆盖表(管理后台「模型设置」页)。
-- 只存模型名;API key 留在服务器 env,不进数据库(安全红线)。
CREATE TABLE IF NOT EXISTS model_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
