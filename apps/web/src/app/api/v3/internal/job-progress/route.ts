import { requireAgentSecret } from '@/lib/auth/require-agent-secret';
import { fromException } from '@/lib/api/from-exception';
import { handleV3JobProgress } from './handler';

// v3 callback sink — the agent posts /v3/analyze progress/completed/failed here
// (separate route from v2: the V3Callback envelope carries the V3 章节树 + preview
// pages, a different shape from the v2 envelope). Authed with AGENT_SHARED_SECRET
// (§3 secret — never bundled to the client). docs/agent/v3-requirements.md §8.
export async function POST(req: Request) {
  try {
    requireAgentSecret(req);
    return await handleV3JobProgress(req);
  } catch (e) {
    return fromException(e);
  }
}
