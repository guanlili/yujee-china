import { env } from '@/lib/env';
import { ERRORS } from '@/lib/api/error-codes';

export function requireAgentSecret(req: Request): void {
  const header = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${env.AGENT_SHARED_SECRET}`;
  if (header !== expected) throw ERRORS.AGENT_UNAUTHORIZED();
}
