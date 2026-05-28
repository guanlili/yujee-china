import { requireAuth } from '@/lib/auth/require-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { chatService } from '@/services/chat/chat-service';

export async function GET(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const limitParam = Number(new URL(req.url).searchParams.get('limit'));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 50;
    const data = await chatService.listMessages(user.id, uuid, limit);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
