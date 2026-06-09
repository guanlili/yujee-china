import { requireAuth } from '@/lib/auth/require-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { generationService } from '@/services/generation/generation-service';

// POST /api/v2/albums/[uuid]/finalize — start the finalize job (Stage 5). No
// body: the authoring tree is the server-side truth in draft_json (invariant 12,
// the tree never round-trips through the browser). Returns { albumId, requestId,
// accepted }. rebuild-tech-plan.md §1.4.
export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const data = await generationService.submitFinalizeV2(user.id, uuid);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
