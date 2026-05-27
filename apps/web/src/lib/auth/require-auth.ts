import { ERRORS } from '@/lib/api/error-codes';

export type AuthUser = { id: string; email: string };

export async function requireAuth(req: Request): Promise<AuthUser> {
  const { getAuth } = await import('./better-auth');
  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session?.user?.id || !session.user.email) {
    throw ERRORS.UNAUTHORIZED();
  }

  return { id: session.user.id, email: session.user.email };
}
