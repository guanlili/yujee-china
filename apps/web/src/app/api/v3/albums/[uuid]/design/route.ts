import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';

// 设计环节:用户在对话框选定封面组(封面+封尾模板×照片)后调用。
// 服务端调 engine /v3/design 拿决策,再确定性应用到 draft(组页+sweep+页序)。
const BodySchema = z
  .object({
    language: z.enum(['zh', 'en']),
    coverTemplateId: z.string().min(1),
    coverPhotoId: z.string().min(1),
    endingTemplateId: z.string().min(1),
    endingPhotoId: z.string().min(1),
  })
  .strict();

// 两次模型调用(字体颜色 + 封面封尾文案)并发,单次同步请求内完成。
export const maxDuration = 90;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const result = await albumService.applyDesign(user.id, uuid, body);
    return ok({ pageCount: result.pages.length, pages: result.pages });
  } catch (e) {
    return fromException(e);
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    return ok(await albumService.listCoverSets(user.id, uuid));
  } catch (e) {
    return fromException(e);
  }
}
