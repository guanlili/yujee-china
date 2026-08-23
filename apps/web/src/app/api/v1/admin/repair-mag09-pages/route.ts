import { requireAdminOrCron } from '@/lib/auth/cron-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { repairMag09Pages } from '@/services/album/repair-mag09-pages';

// mag-09 老书页面修复(2026-08-23,一次性维护接口)。病因与补丁口径见
// services/album/repair-mag09-html.ts 抬头:三个文字槽曾被外层定位推出页面,
// 模板已修但存库 html 是页面真相、烘过不再重烘,老书要靠这个接口补。
//
// **默认只统计不写**(dry-run)。真要写库加 `?apply=1`。幂等,重复调用安全。
// GET 也放行:管理员在登录态浏览器里直接开 URL 触发(与 repair-draft-pages 同口径 ——
// 生产 DATABASE_URL 是 sensitive env,本地连不上库,只有生产运行时能跑)。
async function handle(req: Request) {
  try {
    const actorId = await requireAdminOrCron(req);
    const apply = new URL(req.url).searchParams.get('apply') === '1';
    const data = await repairMag09Pages(actorId, apply);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}

export const GET = handle;
export const POST = handle;
