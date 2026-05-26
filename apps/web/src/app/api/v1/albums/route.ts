import { requireAuth } from '@/lib/auth/require-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';

export async function GET(req: Request) {
  try {
    const user = await requireAuth(req);
    const data = await albumService.listByUser(user.id);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
