// 登录后标记已读(把水位推进到当前时间)。POST 幂等。
import { NextRequest } from 'next/server';
import { getAuthUser } from '@/lib/auth/require-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { markSeen } from '@/db/repos/changelog-repo';

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    await markSeen(user.id);
    return ok({ seen: true });
  } catch (e) {
    return fromException(e);
  }
}
