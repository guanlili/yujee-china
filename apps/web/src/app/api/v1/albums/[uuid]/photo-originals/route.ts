import { requireRealUser } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { photoOriginalService } from '@/services/album/photo-original-service';
import { PhotoOriginalConfirmBodySchema } from '@/services/album/photo-original-util';

// confirm:浏览器把「确实 PUT 成功的」entries 与「放弃的」missing 传回,服务端在
// album 行锁内并入 album_photos 台账,返回全册最新 {uploaded, missing} 计数。
export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireRealUser(req);
    const { uuid } = await ctx.params;
    const { entries, missing } = await parseBody(PhotoOriginalConfirmBodySchema, req);
    const data = await photoOriginalService.confirm(user.id, uuid, { entries, missing });
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
