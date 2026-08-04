import { requireRealUser } from '@/lib/auth/require-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { creditService } from '@/services/credit/credit-service';

export async function GET(req: Request) {
  try {
    const user = await requireRealUser(req);
    const raw = Number(new URL(req.url).searchParams.get('limit'));
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 100) : 50;
    const entries = await creditService.listHistory(user.id, limit);
    return ok({ entries });
  } catch (e) {
    return fromException(e);
  }
}
