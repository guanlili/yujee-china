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
    default:
      // V3Callback 只剩 progress/completed/failed 三类事件,zod 已在解析时挡住其它值,
      // 这个分支正常永远走不到。保留它是为了将来加事件时不会被悄悄吞成 accepted:true。
      logger.warn(
        { requestId: (payload as { requestId: string }).requestId, event: (payload as { event: string }).event },
        'v3 callback event not handled by this dispatcher',
      );
      break;
  }

  return ok({ accepted: true });
}
