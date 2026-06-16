import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumAuthoringService } from '@/services/album/album-authoring-service';

// Browser-facing inspect-render body (#165 Phase 3). After /draft-edit returns
// kind:'inspect', the browser renders + screenshots that one page and posts the
// data-URI here. The single page slice + that page's photos are assembled
// server-side from draft_json (invariant 12). The `screenshot` is the only new
// base64 channel — it goes straight into the agent's vision request and is never
// persisted/logged (invariant 1/2, same posture as init vision).
const BodySchema = z.object({
  pageIndex: z.number().int().nonnegative(),
  userMessage: z.string().min(1).max(500),
  screenshot: z.string().min(1),
});

// POST /api/v2/albums/[uuid]/inspect-render — synchronous (one vision call).
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const data = await albumAuthoringService.submitInspectRenderV2(user.id, uuid, body);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
