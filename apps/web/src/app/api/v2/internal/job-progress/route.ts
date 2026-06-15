import { requireAgentSecret } from '@/lib/auth/require-agent-secret';
import { fromException } from '@/lib/api/from-exception';
import { handleV2JobProgress } from './handler';

// v2 callback sink — the agent posts init/finalize progress/completed/failed here
// (separate route from v1: the v2 envelope carries jobKind and the two completed
// shapes are mutually exclusive). Authed with AGENT_SHARED_SECRET (invariant 10).
// docs/agent/rebuild-tech-plan.md §1.1 / §11.
export async function POST(req: Request) {
  try {
    requireAgentSecret(req);
    return await handleV2JobProgress(req);
  } catch (e) {
    return fromException(e);
  }
}
