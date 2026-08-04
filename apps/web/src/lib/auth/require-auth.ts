import { ERRORS } from '@/lib/api/error-codes';

export type AuthUser = { id: string; email: string };
export type AuthUserWithFlags = AuthUser & { isAnonymous: boolean };

// 有 session 就行(匿名影子账号也算登录)。创作链路(建相册/讲故事/选版/占位成稿…)
// 全部用它;真实账号专属能力(对话改书/保存/分享/R2 写入/计费面)用 requireRealUser。
export async function requireAuth(req: Request): Promise<AuthUser> {
  const { getAuth } = await import('./better-auth');
  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session?.user?.id || !session.user.email) {
    throw ERRORS.UNAUTHORIZED();
  }

  return { id: session.user.id, email: session.user.email };
}

// 带 isAnonymous 的版本:回表读(照 requireAdmin 的理由 —— session cookieCache 有
// 5 分钟陈旧窗,转正瞬间的请求不能被旧 cookie 骗过)。需要按匿名分流的路由用它。
export async function getAuthUser(req: Request): Promise<AuthUserWithFlags> {
  const base = await requireAuth(req);
  const { userRepo } = await import('@/db/repos/user-repo');
  const row = await userRepo.findById(base.id);
  if (!row) throw ERRORS.UNAUTHORIZED();
  return { id: row.id, email: row.email, isAnonymous: row.isAnonymous };
}

// 纯判定(可单测,照 require-admin 的 isAllowlistedAdminEmail 模式):匿名 → 403。
export function assertRealUser(user: AuthUserWithFlags): AuthUser {
  if (user.isAnonymous) throw ERRORS.ANON_UPGRADE_REQUIRED();
  return { id: user.id, email: user.email };
}

// 真实账号专属:匿名(游客)一律 403 ANON_UPGRADE_REQUIRED,前端统一拦截弹登录。
export async function requireRealUser(req: Request): Promise<AuthUser> {
  return assertRealUser(await getAuthUser(req));
}
