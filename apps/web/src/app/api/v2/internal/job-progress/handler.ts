import { V2Callback } from '@yujee/contracts';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { jobService } from '@/services/job/job-service';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { logger } from '@/lib/log/logger';

export async function handleV2JobProgress(req: Request) {
  const payload = await parseBody(V2Callback, req);
  const job = await agentJobRepo.findByRequestId(payload.requestId);
  if (!job) {
    logger.warn({ requestId: payload.requestId }, 'v2 callback for unknown job');
    return ok({ accepted: false });
  }
  if (job.kind !== payload.jobKind) {
    logger.error(
      { requestId: payload.requestId, payloadKind: payload.jobKind, jobKind: job.kind },
      'v2 callback jobKind mismatch - dropping',
    );
    return ok({ accepted: false });
  }

  switch (payload.event) {
    case 'progress':
      await jobService.handleProgress(payload.requestId, payload.stage, payload.progress);
      break;
    case 'completed':
      if (payload.jobKind === 'init') {
        await jobService.handleInitCompleted(payload.requestId, payload.draftTree, payload.usage);
      } else if (payload.jobKind === 'add') {
        await jobService.handleAddCompleted(
          payload.requestId,
          payload.newPhotos,
          payload.newPages,
          payload.usage,
        );
      } else {
        await jobService.handleFinalizeCompleted(payload.requestId, payload.layout, payload.usage);
      }
      break;
    case 'failed':
      await jobService.handleV2Failed(payload.requestId, payload.error);
      break;
  }

  return ok({ accepted: true });
}
