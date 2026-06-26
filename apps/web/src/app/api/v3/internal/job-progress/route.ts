import { requireAgentSecret } from '@/lib/auth/require-agent-secret';
import { fromException } from '@/lib/api/from-exception';
import { handleV3JobProgress } from './handler';

// v3 callback sink — the agent posts analyze/select-layout progress, completed,
// and failed envelopes here. Authed with AGENT_SHARED_SECRET (§3 secret — never
// bundled to the client). docs/agent/v3-requirements.md §8.
export async function POST(req: Request) {
  try {
    requireAgentSecret(req);
    return await handleV3JobProgress(req);
  } catch (e) {
    return fromException(e);
  }
}
