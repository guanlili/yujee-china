import { z } from 'zod';
import { requireAgentSecret } from '@/lib/auth/require-agent-secret';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { jobService } from '@/services/job/job-service';

const Envelope = z.object({
  requestId: z.string().min(1),
  event: z.enum(['progress', 'completed', 'failed']),
  stage: z.enum(['vision', 'writing', 'composing']).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  message: z.string().optional(),
  layout: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
  usage: z.unknown().optional(),
});

export async function POST(req: Request) {
  try {
    requireAgentSecret(req);
    const body = await parseBody(Envelope, req);

    if (body.event === 'progress') {
      await jobService.handleProgress(body.requestId, body.stage ?? 'vision', body.progress ?? 0);
    } else if (body.event === 'completed') {
      await jobService.handleCompleted(body.requestId, body.layout, body.usage);
    } else {
      await jobService.handleFailed(
        body.requestId,
        body.error ?? { code: 'AGENT_INTERNAL_ERROR', message: 'unspecified' },
      );
    }
    return ok({ accepted: true });
  } catch (e) {
    return fromException(e);
  }
}
