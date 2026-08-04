import { z } from 'zod';
import { requireRealUser } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { inviteService } from '@/services/invite/invite-service';

// 兑换邀请码:登录用户填码 → 加积分。成功返回本次积分数 + 新余额;
// 失败返回具体错误码(INVITE_CODE_INVALID/EXPIRED/USED/EXHAUSTED),前端本地化提示。
const BodySchema = z.object({ code: z.string().min(1).max(64) });

export async function POST(req: Request) {
  try {
    const user = await requireRealUser(req);
    const body = await parseBody(BodySchema, req);
    const data = await inviteService.redeem(user.id, body.code);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
