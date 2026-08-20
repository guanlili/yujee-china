import { headers } from 'next/headers';
import { ERRORS } from '@/lib/api/error-codes';
import { userRepo } from '@/db/repos/user-repo';
import { isAdminUser } from './admin-allowlist';

export type AdminUser = { id: string; email: string };

export { isAllowlistedAdminEmail } from './admin-allowlist';


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
  if (!isAdminUser(user)) {
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
