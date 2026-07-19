import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/require-admin';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { adminService } from '@/services/admin/admin-service';

const schema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
  name: z.string().trim().max(100).optional(),
});

// POST only: admin UI. Manual account creation for users who cannot self-register
// (no verification email / blocked OAuth). Always a deliberate human action, so it
// requires a real admin session (requireAdmin, no cron path).
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req.headers);
    const body = await parseBody(schema, req);
    const data = await adminService.createUser(admin.id, body);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
