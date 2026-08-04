import { requireRealUser } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { photoOriginalService } from '@/services/album/photo-original-service';
import { PhotoOriginalEntriesBodySchema } from '@/services/album/photo-original-util';

// 照片原图迁 R2(Phase 0):浏览器在开始上传原图前,按 photoId 列表批量换签名 PUT。
export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireRealUser(req);
    const { uuid } = await ctx.params;
    const { entries } = await parseBody(PhotoOriginalEntriesBodySchema, req);
    const data = await photoOriginalService.signUpload(user.id, uuid, entries);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
