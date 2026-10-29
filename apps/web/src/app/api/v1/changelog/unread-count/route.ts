// 登录后返回未读更新数(用于导航栏徽标)。
import { NextRequest } from 'next/server';
import { getAuthUser } from '@/lib/auth/require-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { unreadCount } from '@/db/repos/changelog-repo';

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    const count = await unreadCount(user.id);
    return ok({ count });
  } catch (e) {
    return fromException(e);
  }
}
