import { z } from 'zod';
import { requireRealUser } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { PHOTO_MASK_URLS_MAX, getCutoutMaskUrls } from '@/services/album/photo-mask-service';
import { isValidPhotoId } from '@/services/album/photo-snapshot-util';

// 抠图 mask 的签名 GET(TTL 300s)。渲染侧按 photoId 问,有 maskKey 的才出 URL;
// 没出的照片浏览器就退回自己那套抠图。
//
// `.strict()` + photoId 形状校验:key 一律由服务端从 (albumId, photoId) 推导,
// 调用方给不了 key —— 与 photo-originals 同一条闸。
const Body = z.object({
  photoIds: z.array(z.string().refine(isValidPhotoId, 'invalid photoId')).min(1).max(PHOTO_MASK_URLS_MAX),
}).strict();

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireRealUser(req);
    const { uuid } = await ctx.params;
    const { photoIds } = await parseBody(Body, req);
    return ok(await getCutoutMaskUrls(user.id, uuid, photoIds));
  } catch (e) {
    return fromException(e);
  }
}
