import { V3Callback } from '@yujee/contracts';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { jobService } from '@/services/job/job-service';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { logger } from '@/lib/log/logger';

// v3 callback dispatcher (WP1.1). The agent posts analyze progress/completed/failed
// here as a V3Callback envelope (jobKind always 'analyze'). The V3 analyze job is
// stored under agent_jobs.kind='init' (no kind migration), so unlike the v2 handler
// there is no DB-kind cross-check — V3Callback only ever carries 'analyze', and the
// requestId already pins the exact job. Mirrors handleV2JobProgress otherwise.
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
    case 'completed':
      await jobService.handleV3AnalyzeCompleted(payload.requestId, payload.tree, payload.pages, payload.usage);
      break;
    case 'failed':
      await jobService.handleV3Failed(payload.requestId, payload.error);
      break;
  }

  return ok({ accepted: true });
}
