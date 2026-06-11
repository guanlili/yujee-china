import { requireAuth } from '@/lib/auth/require-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';

// GET /api/v2/albums/[uuid]/draft — read-only RENDER projection of the authoring
// tree (draft_json) for the v2 authoring flow's skeleton preview (W10 #140).
// Returns { draft: <skeleton> | null }: a flattened, re-indexed page list (cover
// → toc? → chapter pages → ending) plus per-chapter metadata (label/role/state/
// askCount + page range). Read-only — the tree is never edited in the browser
// (invariant 12); edits flow through theme/chapter-chat, which re-slice draft_json
// server-side. draft is null when the album isn't in the draft phase (no draft, or
// already finalized).
export async function GET(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const draft = await albumService.getDraftSkeleton(user.id, uuid);
    return ok({ draft });
  } catch (e) {
    return fromException(e);
  }
}
