import { z } from 'zod';
import { requireAdminOrCron } from '@/lib/auth/cron-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { adminService } from '@/services/admin/admin-service';

const schema = z.object({
  olderThanDays: z.number().int().min(1).max(365).optional(),
});

// GET: Vercel cron. No JSON body — olderThanDays comes from the query string
// (?olderThanDays=N), defaulting to the service's own cutoff when absent/invalid.
export async function GET(req: Request) {
  try {
    const actorId = await requireAdminOrCron(req);
    const raw = new URL(req.url).searchParams.get('olderThanDays');
    const parsed = schema.safeParse({ olderThanDays: raw == null ? undefined : Number(raw) });
    if (!parsed.success) throw parsed.error;
    const data = await adminService.cleanupAbandoned(actorId, parsed.data);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}

// POST: admin UI, olderThanDays in the JSON body.
export async function POST(req: Request) {
  try {
    const actorId = await requireAdminOrCron(req);
    const { olderThanDays } = await parseBody(schema, req);
    const data = await adminService.cleanupAbandoned(actorId, { olderThanDays });
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
