import { requireAuth } from '@/lib/auth/require-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { creditService } from '@/services/credit/credit-service';

export async function GET(req: Request) {
  try {
    const user = await requireAuth(req);
    const balance = await creditService.getBalance(user.id);
    return ok({ balance });
  } catch (e) {
    return fromException(e);
  }
}
