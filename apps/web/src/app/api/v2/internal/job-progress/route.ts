import { V2Callback } from '@yujee/contracts';
import { requireAgentSecret } from '@/lib/auth/require-agent-secret';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { jobService } from '@/services/job/job-service';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { logger } from '@/lib/log/logger';

// v2 callback sink — the agent posts init/finalize progress/completed/failed here
// (separate route from v1: the v2 envelope carries jobKind and the two completed
// shapes are mutually exclusive). Authed with AGENT_SHARED_SECRET (invariant 10).
// docs/agent/rebuild-tech-plan.md §1.1 / §11.
export async function POST(req: Request) {
  try {
    requireAgentSecret(req);
    const payload = await parseBody(V2Callback, req);

    // Hard cross-check (tech-plan §1.1): the callback must name the SAME job and
    // the SAME kind the DB recorded — otherwise an init job could be fed a
    // finalize-shaped payload (or vice versa) and write the wrong branch.
    const job = await agentJobRepo.findByRequestId(payload.requestId);
    if (!job) {
      // Unknown / late requestId (e.g. row already swept away) → drop, ack 200 so
      // the agent stops retrying. Mirrors the v1 idempotent drop.
      logger.warn({ requestId: payload.requestId }, 'v2 callback for unknown job');
      return ok({ accepted: false });
    }
    if (job.kind !== payload.jobKind) {
      logger.error(
        { requestId: payload.requestId, payloadKind: payload.jobKind, jobKind: job.kind },
        'v2 callback jobKind mismatch — dropping',
      );
      return ok({ accepted: false });
    }

    switch (payload.event) {
      case 'progress':
        // stage/progress update; handler re-checks terminal status (idempotent).
        await jobService.handleProgress(payload.requestId, payload.stage, payload.progress);
        break;
      case 'completed':
        if (payload.jobKind === 'init') {
          await jobService.handleInitCompleted(payload.requestId, payload.draftTree, payload.usage);
        } else {
          await jobService.handleFinalizeCompleted(payload.requestId, payload.layout, payload.usage);
        }
        break;
      case 'failed':
        await jobService.handleV2Failed(payload.requestId, payload.error);
        break;
    }

    return ok({ accepted: true });
  } catch (e) {
    return fromException(e);
  }
}
