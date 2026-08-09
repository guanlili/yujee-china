import { z } from 'zod';
import { getAuthUser, requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';

// 设计环节:用户在对话框选定封面组(封面+封尾模板×照片)后调用。
// 服务端**异步派发** engine /v3/compose(一次性成稿),立即返回 requestId;
// 组页落库(组封面封尾 + carrier sweep + 烘 html)与 stage='ready' 在回调侧统一做。
const BodySchema = z
  .object({
    language: z.enum(['zh', 'en']),
    coverTemplateId: z.string().min(1),
    coverPhotoId: z.string().min(1),
    endingTemplateId: z.string().min(1),
    endingPhotoId: z.string().min(1),
    // 书页底色(4 色之一,可选;具体色值合法性在 albumService.applyDesign 校验)。
    pageBackground: z.string().min(1).optional(),
    // 第三套(深色椭圆)选中的配色 id;合法性在 albumService.applyDesign 校验。
    coverColorway: z.string().min(1).optional(),
    // 200px 缩略图(photoId → data URL):compose 让模型看真实照片写文案,原图只在浏览器。
    refs: z.record(z.string().min(1), z.string().min(1)).optional(),
  })
  .strict();

// 只是派发一个 job(建行 + 转发 202),不再同步等模型。
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await getAuthUser(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    // 游客走占位成稿(零 AI、零积分、同步组书,refs 用不上);真实账号照旧异步派 compose。
    const result = user.isAnonymous
      ? await albumService.applyPlaceholderDesign(user.id, uuid, body)
      : await albumService.applyDesign(user.id, uuid, body);
    return ok(result);
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
