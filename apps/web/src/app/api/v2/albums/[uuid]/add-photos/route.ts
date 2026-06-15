import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { generationService } from '@/services/generation/generation-service';
import { BodySchema } from './schema';

// Forwards a multi-MB base64 payload to the agent and waits for its 202; 60s gives
// the cross-region submit room (same as init).
export const maxDuration = 60;
type RouteCtx = { params: Promise<{ uuid: string }> };

export async function POST(req: Request, ctx: RouteCtx) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const data = await generationService.submitAddPhotosV2(user.id, uuid, body);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}

// Poll the add job by requestId. The editor calls this until status leaves
// 'running', then injects the new pages (completed) or surfaces the error (failed).
export async function GET(req: Request, ctx: RouteCtx) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const requestId = new URL(req.url).searchParams.get('requestId') ?? '';
    const data = await generationService.getAddStatus(user.id, uuid, requestId);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
