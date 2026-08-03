import { requireAdminOrCron } from '@/lib/auth/cron-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { adminService } from '@/services/admin/admin-service';

// draft_pages 行修复(2026-08-03 线上事故,一次性维护接口):以 legacy draftJson.pages
// 数组序重建行,详见 adminService.repairDraftPages 抬头。幂等,重复调用安全。
// GET 也放行:管理员在登录态浏览器里直接开 URL 触发(生产 DATABASE_URL 是 sensitive
// env,本地拉不出来,只有生产运行时能连库)。
async function handle(req: Request) {
  try {
    const actorId = await requireAdminOrCron(req);
    const data = await adminService.repairDraftPages(actorId);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}

export const GET = handle;
export const POST = handle;
