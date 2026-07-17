import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';
import { PHOTO_SNAPSHOT_MAX_COUNT } from '@/services/album/photo-snapshot-util';

// 手动照片备份(photo-snapshot-design.md):浏览器点「保存」时,按 photoId 列表批量
// 换签名 PUT,把 display 档压缩图直传 R2。原图仍不上传。
const BodySchema = z.object({
  photoIds: z.array(z.string()).min(1).max(PHOTO_SNAPSHOT_MAX_COUNT),
});

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const { photoIds } = await parseBody(BodySchema, req);
    const data = await albumService.signPhotoSnapshotUpload(user.id, uuid, photoIds);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
