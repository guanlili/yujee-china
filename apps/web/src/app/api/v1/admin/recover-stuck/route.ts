import { requireAdmin } from '@/lib/auth/require-admin';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { adminService } from '@/services/admin/admin-service';

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req.headers);
    const data = await adminService.recoverStuck(admin.id);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
