import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { collaborationService } from '@/services/collaboration/collaboration-service';

// 草稿增量变化(collab plan §7.4):owner/editor 2.5s 轮询。
// ?since=N —— 客户端已知的全书 revision(初值来自 draft skeleton)。
const SinceSchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);

export async function GET(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const url = new URL(req.url);
    const rawSince = url.searchParams.get('since');
    if (rawSince === null) {
      return ok(await collaborationService.getChanges(user.id, uuid, 0));
    }
    const parsed = SinceSchema.safeParse(rawSince);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: { code: 'VALIDATION_FAILED', message: 'since must be an integer in [0, MAX_SAFE_INTEGER]' } },
        { status: 400 },
      );
    }
    const data = await collaborationService.getChanges(user.id, uuid, parsed.data);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
