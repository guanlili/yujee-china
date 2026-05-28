import { requireAuth } from '@/lib/auth/require-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { userService } from '@/services/user/user-service';

export async function GET(req: Request) {
  try {
    const user = await requireAuth(req);
    const data = await userService.getMe(user.id);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
