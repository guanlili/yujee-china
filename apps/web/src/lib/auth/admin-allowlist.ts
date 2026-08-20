import { env } from '@/lib/env';

// 「谁算 admin」的唯一真相,单独成模块是为了让 service 层也能用同一份判定 ——
// require-admin.ts 顶层依赖 next/headers(请求上下文),service/测试引不进来。
//
// 两处判定曾经不一致:页面层认 isAdmin || 白名单邮箱,而 adminService.previewAlbum
// 只认 DB 的 isAdmin,结果靠 ADMIN_EMAILS 进后台的人能看用户列表、点相册就被拒成 404。
// 任何新的 admin 校验点都从这里取,别再各写一份。
//
// Emails granted admin via env (see ADMIN_EMAILS in env.ts). Parsed on each call
// off the already-validated env string — cheap, and lets a redeploy change the
// set without a code change. Comparison is trimmed + lowercased on both sides.
// `allowlist` is injectable so it can be unit-tested without env-load timing.
export function isAllowlistedAdminEmail(
  email: string | null | undefined,
  allowlist: string | undefined = env.ADMIN_EMAILS,
): boolean {
  if (!email) return false;
  const target = email.trim().toLowerCase();
  if (!target) return false;
  return (allowlist ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(target);
}

/** DB 标志或白名单邮箱,任一成立即为 admin。页面层与 service 层必须用同一个判定。 */
export function isAdminUser(user: { isAdmin: boolean; email: string | null }): boolean {
  return user.isAdmin || isAllowlistedAdminEmail(user.email);
}
