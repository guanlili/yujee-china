import { requireAgentSecret } from '@/lib/auth/require-agent-secret';
import { fromException } from '@/lib/api/from-exception';
import { handleAgentData } from './handler';

export async function GET(req: Request) {
  try {
    requireAgentSecret(req);
    return await handleAgentData(req);
  } catch (e) {
    return fromException(e);
  }
}
