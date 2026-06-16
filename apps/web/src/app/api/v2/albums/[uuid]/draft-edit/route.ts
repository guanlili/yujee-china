import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumAuthoringService } from '@/services/album/album-authoring-service';

// Browser-facing draft-edit body (#162). The single page slice + that page's
// photos + history are assembled server-side from draft_json + album_messages
// (invariant 12 — only the one focused page goes to the agent). The browser owns
// the FLAT pageIndex it's looking at and the user's message.
const BodySchema = z.object({
  pageIndex: z.number().int().nonnegative(),
  userMessage: z.string().min(1).max(500),
});

// POST /api/v2/albums/[uuid]/draft-edit — synchronous (#162). talk/act split.
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const data = await albumAuthoringService.submitDraftEditV2(user.id, uuid, body);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
