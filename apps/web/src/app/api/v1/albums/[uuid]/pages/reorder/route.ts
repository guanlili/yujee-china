import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';

// 整页交换的原子落库(2026-08-01 设计)。permutation[newIndex] = oldIndex,
// 必须是 0..n-1 的完整双射;双射性/锚定页(cover·toc·ending 不许动)在
// albumService.reorderPages 的事务里校验 —— 这里只做形状检查。
const BodySchema = z.object({
  permutation: z.array(z.number().int().nonnegative()).min(2),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ uuid: string }> },
) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const data = await albumService.reorderPages(user.id, uuid, body.permutation);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
