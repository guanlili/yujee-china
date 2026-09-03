import { requireAuth } from '@/lib/auth/require-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { collaborationService } from '@/services/collaboration/collaboration-service';

// 协同成员管理(collab plan §15.3)。owner-only:editor 与路人调 GET 都会收到
// requireOwner 的 ALBUM_NOT_OWNED。
export async function GET(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    return ok(await collaborationService.listMembers(user.id, uuid));
  } catch (e) {
    return fromException(e);
  }
}
