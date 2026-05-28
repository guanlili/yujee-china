import { headers } from 'next/headers';
import { ERRORS } from '@/lib/api/error-codes';
import { userRepo } from '@/db/repos/user-repo';

export type AdminUser = { id: string; email: string };

// isAdmin is read fresh from the row, not the session cookie cache, so a
// revoked admin loses access immediately even within the 5min cookie window.
export async function requireAdmin(headers: Headers): Promise<AdminUser> {
  const { getAuth } = await import('./better-auth');
  const session = await getAuth().api.getSession({ headers });
  if (!session?.user?.id || !session.user.email) {
    throw ERRORS.UNAUTHORIZED();
  }

  const user = await userRepo.findById(session.user.id);
  if (!user?.isAdmin) {
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
