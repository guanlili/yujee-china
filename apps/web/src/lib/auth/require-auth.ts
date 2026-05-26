import { env } from '@/lib/env';

export type AuthUser = { id: string; email: string };

export async function requireAuth(_req: Request): Promise<AuthUser> {
  return { id: env.DEMO_USER_ID, email: env.DEMO_USER_EMAIL };
}
