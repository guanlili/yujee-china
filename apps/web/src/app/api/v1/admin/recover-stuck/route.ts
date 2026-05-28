import { requireAdminOrCron } from '@/lib/auth/cron-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { adminService } from '@/services/admin/admin-service';

// GET: Vercel cron (Authorization: Bearer <CRON_SECRET>). POST: admin UI (session).
async function handle(req: Request) {
  try {
    const actorId = await requireAdminOrCron(req);
    const data = await adminService.recoverStuck(actorId);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}

export const GET = handle;
export const POST = handle;
