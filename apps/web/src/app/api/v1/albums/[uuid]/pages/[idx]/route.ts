import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';

const BodySchema = z
  .object({
    imagesJson: z.record(z.string(), z.string()).optional(),
    textsJson: z.record(z.string(), z.string()).optional(),
  })
  .refine((b) => b.imagesJson !== undefined || b.textsJson !== undefined, {
    message: 'imagesJson or textsJson required',
  });

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
