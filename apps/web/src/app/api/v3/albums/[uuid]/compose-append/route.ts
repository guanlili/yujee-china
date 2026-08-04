import { z } from 'zod';
import { getAuthUser } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';

// 追加范围成稿:加图增量排版落地后,只为新章内页写文案(异步派发 engine /v3/compose,
// 空 cover/ending 槽 → 不写封面不动字体)。composed:false = 书未设计,等选封面全书成稿。
export const maxDuration = 60;

const BodySchema = z
  .object({
    language: z.enum(['zh', 'en']),
    chapterIds: z.array(z.string().min(1)).min(1).max(50),
    // 200px 缩略图(photoId → data URL):模型看真实照片写文案,原图只在浏览器。
    refs: z.record(z.string().min(1), z.string().min(1)).optional(),
  })
  .strict();

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await getAuthUser(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const result = await albumService.composeAppend(user.id, uuid, body, {
      isAnonymous: user.isAnonymous,
    });
    return ok(result);
  } catch (e) {
    return fromException(e);
  }
}
