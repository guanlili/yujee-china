import { requireRealUser } from '@/lib/auth/require-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { logger } from '@/lib/log/logger';
import { collaborationService } from '@/services/collaboration/collaboration-service';

// 接受协同编辑邀请(collab plan §7.2)。必须存在真实账号会话(§15.1:匿名影子
// 账号不进跨用户成员关系,前端邀请页先要求登录/注册)。幂等:重复 redeem、
// owner redeem 自己的链接都安全。
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const user = await requireRealUser(req);
    const { token } = await ctx.params;
    const { albumId } = await collaborationService.redeemEditLink(user.id, token);
    logger.info(
      { albumId, userId: user.id },
      'collab.edit_link_redeemed',
    );
    return ok({ albumId });
  } catch (e) {
    return fromException(e);
  }
}
