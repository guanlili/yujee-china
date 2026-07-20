import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/require-admin';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { adminService } from '@/services/admin/admin-service';

const schema = z.object({
  code: z.string().trim().min(1).max(64),
  credits: z.number().int().positive(),
  expiryDays: z.number().int().positive(),
  // null = no cap on total uses (still one-per-user).
  maxRedemptions: z.number().int().positive().nullable(),
});

// POST only: admin UI creates a shareable invite code. Deliberate human action,
// so a real admin session is required (requireAdmin, no cron path).
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req.headers);
    const body = await parseBody(schema, req);
    const data = await adminService.createInviteCode(admin.id, body);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
