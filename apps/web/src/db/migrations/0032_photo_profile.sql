-- 照片视觉档案(几何/色彩/语义三组)。契约:packages/contracts/src/photo-profile.ts
-- 存 album_photos 而不是 draft_json:档案是照片的属性,且 draft_json 被整体重写过(b4cba3f1)。
-- null = 还没建档(存量书 / 建档失败),读取方一律要能降级。
ALTER TABLE "album_photos" ADD COLUMN IF NOT EXISTS "profile" jsonb;
