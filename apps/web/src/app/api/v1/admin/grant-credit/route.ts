import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/require-admin';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { adminService } from '@/services/admin/admin-service';

const schema = z.object({
  email: z.string().trim().email(),
  amount: z.number().int(),
  note: z.string().trim().max(200).optional(),
});

// POST only: admin UI. Unlike recover-stuck / cleanup-photos there is no cron
// path here — a credit grant is always a deliberate human action, so it requires
// a real admin session (requireAdmin, not requireAdminOrCron).
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req.headers);
    const body = await parseBody(schema, req);
    const data = await adminService.grantCredit(admin.id, body);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
