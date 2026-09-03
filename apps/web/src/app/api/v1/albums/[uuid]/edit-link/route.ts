import { requireAuth } from '@/lib/auth/require-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { logger } from '@/lib/log/logger';
import { collaborationService } from '@/services/collaboration/collaboration-service';

// 创建/旋转协同编辑邀请链接(collab plan §7.1)。owner-only;每次调用旋转
// token,旧链接立即失效。响应里的 url 由 join 页(Task 8)消费;明文 token
// 只在此响应出现一次,服务端只留 SHA-256 hash。
export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const { token } = await collaborationService.createEditLink(user.id, uuid);
    logger.info(
      { albumId: uuid, ownerId: user.id },
      'collab.edit_link_created',
    );
    return ok({ token });
  } catch (e) {
    return fromException(e);
  }
}
