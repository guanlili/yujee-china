import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/require-admin';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { adminService } from '@/services/admin/admin-service';

const schema = z.object({
  olderThanDays: z.number().int().min(1).max(365).optional(),
});

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req.headers);
    const { olderThanDays } = await parseBody(schema, req);
    const data = await adminService.cleanupAbandoned(admin.id, { olderThanDays });
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
