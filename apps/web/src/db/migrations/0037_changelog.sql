-- 2026-10-30:产品更新日志系统(需求池「产品更新日志系统」)。
CREATE TABLE IF NOT EXISTS changelog_entries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  title_zh TEXT NOT NULL,
  title_en TEXT NOT NULL,
  body_zh TEXT NOT NULL,
  body_en TEXT NOT NULL,
  image_url TEXT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS changelog_last_seen_at TIMESTAMPTZ;
