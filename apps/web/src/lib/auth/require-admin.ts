import { headers } from 'next/headers';
import { ERRORS } from '@/lib/api/error-codes';
import { userRepo } from '@/db/repos/user-repo';
import { env } from '@/lib/env';

export type AdminUser = { id: string; email: string };

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

// isAdmin is read fresh from the row, not the session cookie cache, so a
// revoked admin loses access immediately even within the 5min cookie window.
// A user also counts as admin if their email is in ADMIN_EMAILS — the DB-key-free
// bootstrap so the first admin can be provisioned from the Vercel dashboard.
export async function requireAdmin(headers: Headers): Promise<AdminUser> {
  const { getAuth } = await import('./better-auth');
  const session = await getAuth().api.getSession({ headers });
  if (!session?.user?.id || !session.user.email) {
    throw ERRORS.UNAUTHORIZED();
  }

  const user = await userRepo.findById(session.user.id);
  if (!user) {
    throw ERRORS.UNAUTHORIZED();
  }
  if (!user.isAdmin && !isAllowlistedAdminEmail(user.email)) {
    throw ERRORS.FORBIDDEN();
  }

  return { id: user.id, email: user.email };
}

// Server-component entry: resolves the current admin from request headers,
// returning null instead of throwing so pages can render a forbidden view.
export async function currentAdmin(): Promise<AdminUser | null> {
  try {
    return await requireAdmin((await headers()) as unknown as Headers);
  } catch {
    return null;
  }
}
