import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';
import { V3RecommendRequest } from '@yujee/contracts';

// Browser-facing recommend body (③ 主题/章节色-推荐, WP3.1 #189 / 缺口#20). Invariant 12 /
// §3 数据归属: the authoring tree NEVER round-trips through the browser, so the browser
// holds NO chapter overview — it sends only its language (+ optional free-text/font nudges).
// albumId comes from the URL. The Web service is the sole truth source for draft_json: it
// re-slices the per-chapter overview (description + each photo's sceneDescription摘要, text
// only, NO base64) SERVER-SIDE and forwards the full V3RecommendRequest to the stateless
// agent, which only SUGGESTS theme candidates + per-chapter {accentColor, artFont}. Writing
// the tree (apply-theme) and advancing stage (§8.3 stage 推进权在 Web) happen elsewhere.
const BodySchema = V3RecommendRequest.pick({
  language: true,
  userMessage: true,
  fontHint: true,
}).strict();

// POST /api/v3/albums/[uuid]/recommend — synchronous (§8). 60s budget.
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    // Ownership gate + draft re-slice + forward all live inside the service (§3 数据归属 /
    // never act on another user's album). Throws ALBUM_NOT_FOUND / ALBUM_NOT_OWNED /
    // VALIDATION_FAILED.
    const result = await albumService.recommendTheme(user.id, uuid, body);
    return ok(result);
  } catch (e) {
    return fromException(e);
  }
}
