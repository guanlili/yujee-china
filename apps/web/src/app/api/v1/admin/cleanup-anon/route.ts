import { z } from 'zod';
import { requireAdminOrCron } from '@/lib/auth/cron-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { adminService } from '@/services/admin/admin-service';

const schema = z.object({
  olderThanDays: z.number().int().min(1).max(365).optional(),
});

// 游客(匿名影子账号)清理:创建超 N 天未转正、且一本书都没做 → 删号。
// 做过书的游客永久保留,不进扫描名单(见 user-repo.findAnonymousCreatedBefore)。
// GET: Vercel cron。No JSON body — olderThanDays 走 query(?olderThanDays=N),
// 缺省用 ANON_CLEANUP_DAYS(7)。
export async function GET(req: Request) {
  try {
    const actorId = await requireAdminOrCron(req);
    const raw = new URL(req.url).searchParams.get('olderThanDays');
    const parsed = schema.safeParse({ olderThanDays: raw == null ? undefined : Number(raw) });
    if (!parsed.success) throw parsed.error;
    const data = await adminService.cleanupAnonymous(actorId, parsed.data);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}

// POST: admin UI,olderThanDays 在 JSON body 里。
export async function POST(req: Request) {
  try {
    const actorId = await requireAdminOrCron(req);
    const { olderThanDays } = await parseBody(schema, req);
    const data = await adminService.cleanupAnonymous(actorId, { olderThanDays });
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
