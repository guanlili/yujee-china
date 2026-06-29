import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { ERRORS } from '@/lib/api/error-codes';
import { generationService } from '@/services/generation/generation-service';
import { JudgeLayoutBodySchema } from './schema';

// P2 two-phase select-layout (docs/agent/contract.md §5.2.1).
//   GET  → hand the browser the candidate STRUCTURES to render thumbnails from.
//   POST → dispatch /v3/judge-layout with the browser-rendered thumbnails attached.
// Phase 1's select-layout already holds the credit; phase 2 never re-reserves.
export const maxDuration = 60;

export async function GET(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const requestId = new URL(req.url).searchParams.get('requestId');
    if (!requestId) throw ERRORS.VALIDATION_FAILED('requestId is required');
    const result = await generationService.getJudgeCandidates(user.id, uuid, requestId);
    return ok(result);
  } catch (e) {
    return fromException(e);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(JudgeLayoutBodySchema, req);
    const result = await generationService.submitJudgeLayoutV3(user.id, uuid, body);
    return ok(result);
  } catch (e) {
    return fromException(e);
  }
}
