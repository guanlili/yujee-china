import { requireAuth } from '@/lib/auth/require-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { billingService } from '@/services/billing/billing-service';

export async function GET(req: Request) {
  try {
    const user = await requireAuth(req);
    const data = await billingService.getOverview(user.id);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
