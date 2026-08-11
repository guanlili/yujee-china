import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { generationService } from '@/services/generation/generation-service';
import { RetryBodySchema } from '../../schema';

// Browser-facing retry for V3 analyze. The album id is fixed by the URL; the
// browser resends the photo data from local IndexedDB so the same FAILED album
// can move back to AGENT_RUNNING without creating a duplicate card.
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(RetryBodySchema, req);
    const data = await generationService.retryAnalyzeV3(user.id, uuid, body);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
