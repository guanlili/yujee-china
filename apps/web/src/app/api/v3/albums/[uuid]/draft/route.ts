import { requireAuth } from '@/lib/auth/require-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';

// Read-only V3 draft skeleton projection for the editor preview. The full
// authoring tree remains server-owned in draft_json; only flattened render data
// and chapter ranges are returned.
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
