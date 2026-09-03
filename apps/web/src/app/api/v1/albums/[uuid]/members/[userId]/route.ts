import { requireAuth } from '@/lib/auth/require-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { collaborationService } from '@/services/collaboration/collaboration-service';

// 移除 editor(collab plan §15.3)。owner-only;移除后该成员后续轮询/保存立即 403。
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ uuid: string; userId: string }> },
) {
  try {
    const user = await requireAuth(req);
    const { uuid, userId } = await ctx.params;
    return ok(await collaborationService.removeMember(user.id, uuid, userId));
  } catch (e) {
    return fromException(e);
  }
}
