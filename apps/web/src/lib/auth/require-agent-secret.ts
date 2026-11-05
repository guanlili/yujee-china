import { env } from '@/lib/env';
import { ERRORS } from '@/lib/api/error-codes';
import { timingSafeEqualString } from './timing-safe-equal';

export function requireAgentSecret(req: Request): void {
  const header = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${env.AGENT_SHARED_SECRET}`;
  // 常量时间比较:避免逐字符短路带来的时序侧信道泄露 secret 前缀。
  if (!timingSafeEqualString(header, expected)) throw ERRORS.AGENT_UNAUTHORIZED();
}
