import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumAuthoringService } from '@/services/album/album-authoring-service';

// Browser-facing theme body. The full agent contract (V2ThemeRequest, incl. the
// clusters overview) is assembled server-side from draft_json — the browser only
// owns an optional free-text nudge (invariant 12: the tree never crosses out).
const BodySchema = z.object({ userMessage: z.string().max(500).optional() });

// POST /api/v2/albums/[uuid]/theme — synchronous (Stage 2). rebuild-tech-plan §1.2.
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const data = await albumAuthoringService.submitThemeV2(user.id, uuid, body);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
