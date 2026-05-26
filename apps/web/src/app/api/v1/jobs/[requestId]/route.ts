import { requireAuth } from '@/lib/auth/require-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { jobService } from '@/services/job/job-service';

export async function GET(req: Request, ctx: { params: Promise<{ requestId: string }> }) {
  try {
    const user = await requireAuth(req);
    const { requestId } = await ctx.params;
    const data = await jobService.findStatus(user.id, requestId);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
