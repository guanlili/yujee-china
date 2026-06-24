import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';
import { V3ChapterChatRequest } from '@yujee/contracts';

// Browser-facing chapter-chat body (② 章节故事, WP2.1 #185 / 缺口#20). Invariant 12 /
// §3 数据归属: the authoring tree NEVER round-trips through the browser, so the browser
// holds NO chapter node / pages — it sends only the chapterId it's on, the chat history,
// the user's message (+ the focused page). albumId comes from the URL. The Web service
// is the sole truth source for draft_json: it re-slices the single chapter (chapter node
// + its skeleton pages, §8.3 单章切片) SERVER-SIDE and forwards the full
// V3ChapterChatRequest to the stateless agent, which dispatches THIS turn (引导/写/改)
// by intent and returns kind + reply (+ pagesTexts/layoutPatch). Persisting
// any patch into draft_json + advancing stage/各章 done is the browser-mirror + the
// separate story-progress (markChapterDone) channel; this route never mutates draft_json.
const BodySchema = V3ChapterChatRequest.pick({
  language: true,
  history: true,
  userMessage: true,
  focusedPageIndex: true,
})
  .extend({ chapterId: V3ChapterChatRequest.shape.chapter.shape.chapterId })
  .strict();

// POST /api/v3/albums/[uuid]/chapter-chat — synchronous (§8). 60s budget.
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    // Ownership gate + draft re-slice + forward all live inside the service (§3 数据
    // 归属 / never act on another user's album). Throws ALBUM_NOT_FOUND /
    // ALBUM_NOT_OWNED / VALIDATION_FAILED.
    const result = await albumService.chapterChatTurn(user.id, uuid, body);
    return ok(result);
  } catch (e) {
    return fromException(e);
  }
}
