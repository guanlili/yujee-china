import { z } from 'zod';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { logger } from '@/lib/log/logger';
import { AGENT_PHOTO_BYTES_MAX, getAgentPhotoBytes } from '@/services/album/agent-photo-bytes';

// design-agent 的 look_at_photos 按需取图。
//
// ⚠️ `.strict()` 在这里不只是洁癖:它挡住调用方夹带 `r2Key` 之类的字段。这个口的
// 鉴权只有 AGENT_SHARED_SECRET,一旦接受调用方指定对象,那把钥匙就等于整桶任意
// 对象的读取权(别人的原图、PDF、备份快照都在同一个桶)。key 一律由服务端从
// (albumId, photoId) 推导,归属由 album_photos 兜底。
const PhotoBytesRequest = z.object({
  albumId: z.string().min(1),
  photoIds: z.array(z.string().min(1)).min(1).max(AGENT_PHOTO_BYTES_MAX),
}).strict();

export async function handlePhotoBytes(req: Request) {
  const payload = await parseBody(PhotoBytesRequest, req);
  const result = await getAgentPhotoBytes(payload.albumId, payload.photoIds);
  logger.info(
    { albumId: payload.albumId, requested: payload.photoIds.length, returned: result.photos.length, skipped: result.skipped.length },
    'design-agent photo bytes',
  );
  return ok(result);
}
