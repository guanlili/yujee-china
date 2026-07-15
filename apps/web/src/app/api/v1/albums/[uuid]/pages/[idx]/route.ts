import { z } from 'zod';
import { ImagePos } from '@yujee/contracts';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';

const BodySchema = z
  .object({
    imagesJson: z.record(z.string(), z.string()).optional(),
    textsJson: z.record(z.string(), z.string()).optional(),
    // #165: per-slot position/scale overrides (clamp bounds enforced by ImagePos).
    imagePosJson: z.record(z.string(), ImagePos).optional(),
    // 工具条样式(字号/字体/对齐/颜色等):slotKey → { css属性: 值|null(移除) }。
    // 值层面的注入护栏在 patchHtmlTextStyle(属性名白名单式正则 + 禁 ;{}<>")。
    textStyles: z
      .record(z.string().max(64), z.record(z.string().max(32), z.string().max(200).nullable()))
      .optional(),
  })
  .refine(
    (b) =>
      b.imagesJson !== undefined ||
      b.textsJson !== undefined ||
      b.imagePosJson !== undefined ||
      b.textStyles !== undefined,
    { message: 'imagesJson, textsJson, imagePosJson or textStyles required' },
  );

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ uuid: string; idx: string }> },
) {
  try {
    const user = await requireAuth(req);
    const { uuid, idx } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const data = await albumService.updatePage(user.id, uuid, Number(idx), body);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
