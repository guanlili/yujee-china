import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';
import { agentClient } from '@/lib/agent/agent-client';
import { V3ChapterChatRequest } from '@yujee/contracts';

// Browser-facing chapter-chat body (② 章节故事, WP2.1 #185). The browser holds the
// current chapter subtree (chapter node + this chapter's skeleton pages) from
// draft_json and the dialog UI, and sends the single-chapter slice the agent needs
// (§8.3 单章切片). albumId comes from the URL, so it is stripped from the forwarded
// body's source of truth. The agent is stateless: it dispatches THIS turn
// (引导/写/改) by intent and returns kind + reply (+ pagesTexts/layoutPatch/
// nameOptions). Merging the patch into draft_json + advancing stage/各章 done is
// WP2.4 (§4.2(1)); this route is the thin authenticated forwarder.
const BodySchema = V3ChapterChatRequest.omit({ albumId: true });

// POST /api/v3/albums/[uuid]/chapter-chat — synchronous (§8). 60s budget.
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    // Ownership gate before any agent call (§3 数据归属 / never act on another
    // user's album). Throws ALBUM_NOT_FOUND / ALBUM_NOT_OWNED.
    await albumService.findOwned(user.id, uuid);
    const slice = await parseBody(BodySchema, req);
    const result = await agentClient.chapterChatV3({ albumId: uuid, ...slice });
    return ok(result);
  } catch (e) {
    return fromException(e);
  }
}
