import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';
import { PHOTO_SNAPSHOT_MAX_COUNT } from '@/services/album/photo-snapshot-util';

// 备份 confirm:浏览器把「确实 PUT 成功的」photoId 传回,服务端并进 albums.photo_snapshot。
const BodySchema = z.object({
  photoIds: z.array(z.string()).min(1).max(PHOTO_SNAPSHOT_MAX_COUNT),
});

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const { photoIds } = await parseBody(BodySchema, req);
    const data = await albumService.confirmPhotoSnapshot(user.id, uuid, photoIds);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
