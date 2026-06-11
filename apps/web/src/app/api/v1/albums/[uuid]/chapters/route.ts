import { requireAuth } from '@/lib/auth/require-auth';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';

// Read-only chapter summary for the editor's chapter rail. Chapters are the AI's
// image clusters from the authoring tree (draft_json); this returns only a derived
// summary (label / role / photoIds), never the editable tree — invariant 12 holds
// (the tree never round-trips through the browser for editing). Returns an empty
// list when there's no draft (e.g. a finalized album).
export async function GET(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const data = await albumService.getChapterSummary(user.id, uuid);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
