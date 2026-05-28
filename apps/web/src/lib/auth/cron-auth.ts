import { env } from '@/lib/env';
import { requireAdmin } from './require-admin';

// Pure matcher (env-free for testability). A request is cron-authorized when it
// carries the shared secret as `Authorization: Bearer <secret>` (what Vercel
// cron sends) or `?secret=<secret>` (for manual curl). An unset/empty secret
// never authorizes, so dev — where CRON_SECRET is absent — keeps requiring admin.
export function matchesCronSecret(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get('secret') === secret;
}

export function isCronAuthorized(req: Request): boolean {
  return matchesCronSecret(req, env.CRON_SECRET);
}

// Admin routes are reachable two ways: the admin UI (logged-in session) and
// Vercel cron (no session — Vercel cron can't carry cookies). Cron presents the
// shared secret instead; otherwise fall through to the session admin check.
// Returns the actor id used for audit logging only (authorization already done).
export async function requireAdminOrCron(req: Request): Promise<string> {
  if (isCronAuthorized(req)) return 'cron';
  const admin = await requireAdmin(req.headers);
  return admin.id;
}
