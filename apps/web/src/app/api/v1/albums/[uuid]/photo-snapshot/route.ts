import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';
import { SnapshotEntriesBodySchema } from '@/services/album/photo-snapshot-util';

// 备份 confirm:浏览器把「确实 PUT 成功的」photoId 传回,服务端并进 albums.photo_snapshot。
export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const { entries } = await parseBody(SnapshotEntriesBodySchema, req);
    const data = await albumService.confirmPhotoSnapshot(user.id, uuid, entries);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
