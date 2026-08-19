import { requireRealUser } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { imageGenerationService } from '@/services/album/image-generation-service';
import { GenerateImageBodySchema } from '@/services/album/image-generation-util';

// AI 生图:按用户的自由描述出一张图,存成本册的一张照片(photoId),之后它进哪个
// 图槽都行 —— 封面、封底、内页共用同一条路,因为对下游来说它就是一张照片。
// 扣费、退款、免费重来的编排全在 service 里,这层只做鉴权和入参校验。
// 设计:docs/specs/2026-08-18-ai-image-generation-design.md
// 上游一次生成要十几秒(Ark 美国出口实测 17s,Gemini 未实测),平台默认时长兜不住:
// 被杀掉的时间点在「扣费已提交」之后、「退款/留痕」之前 —— 用户被扣了分、没拿到图、
// 后台还查不到记录。与 v3 那批慢路由同口径给 60s。
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireRealUser(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(GenerateImageBodySchema, req);
    const data = await imageGenerationService.generate({
      userId: user.id,
      albumId: uuid,
      body,
    });
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
