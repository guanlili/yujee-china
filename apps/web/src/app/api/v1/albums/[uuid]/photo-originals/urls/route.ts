import { requireRealUser } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { photoOriginalService } from '@/services/album/photo-original-service';
import { PhotoOriginalUrlsBodySchema } from '@/services/album/photo-original-util';

// 按 photoId 批量换原图的签名 GET(TTL 300s)。只有 status='uploaded' 的才出 URL。
export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireRealUser(req);
    const { uuid } = await ctx.params;
    const { photoIds } = await parseBody(PhotoOriginalUrlsBodySchema, req);
    const data = await photoOriginalService.getUrls(user.id, uuid, photoIds);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
