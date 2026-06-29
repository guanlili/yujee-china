import { V3Callback } from '@yujee/contracts';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { jobService } from '@/services/job/job-service';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { logger } from '@/lib/log/logger';

// v3 callback dispatcher (WP1.1). The agent posts analyze and select-layout
// progress/completed/failed here as a V3Callback envelope. Stage2 reuses the
// original analyze/init requestId, so requestId pins the same agent_jobs row
// across tree creation, layout page merge, and final hold settlement.
export async function handleV3JobProgress(req: Request) {
  const payload = await parseBody(V3Callback, req);
  const job = await agentJobRepo.findByRequestId(payload.requestId);
  if (!job) {
    logger.warn({ requestId: payload.requestId }, 'v3 callback for unknown job');
    return ok({ accepted: false });
  }

  switch (payload.event) {
    case 'progress':
      await jobService.handleV3Progress(payload.requestId, payload.stage, payload.progress);
      break;
    // P2 phase 1 (docs/agent/contract.md §5.2.1): select-layout candidate structures
    // for the browser to render. Holds the job open, stashes candidates; no stage advance.
    case 'candidates':
      await jobService.handleV3SelectLayoutCandidates(payload.requestId, payload.units, payload.usage);
      break;
    case 'completed':
      if (payload.jobKind === 'analyze') {
        await jobService.handleV3AnalyzeCompleted(payload.requestId, payload.tree, payload.usage);
      } else {
        await jobService.handleV3SelectLayoutCompleted(payload.requestId, payload.pages, payload.usage);
      }
      break;
    case 'failed':
      await jobService.handleV3Failed(payload.requestId, payload.error);
      break;
  }

  return ok({ accepted: true });
}
