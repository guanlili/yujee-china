import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';
import { agentClient } from '@/lib/agent/agent-client';
import { V3RecommendRequest } from '@yujee/contracts';

// Browser-facing recommend body (③ 主题/章节色-推荐, WP3.1 #189). The browser holds
// the chapter overview (each chapter's description + its photos' scene descriptions)
// and the analysis summary from draft_json, and sends them as the text-only slice
// the agent needs (no base64 — §3 privacy by construction). albumId comes from the
// URL, so it is stripped from the forwarded body's source of truth. The agent is
// stateless: it only SUGGESTS theme candidates + per-chapter {accentColor, artFont};
// writing the tree (apply-theme/WP3.2) and advancing stage (§8.3 stage 推进权在 Web)
// happen elsewhere. This route is the thin authenticated forwarder.
const BodySchema = V3RecommendRequest.omit({ albumId: true });

// POST /api/v3/albums/[uuid]/recommend — synchronous (§8). 60s budget.
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    // Ownership gate before any agent call (§3 数据归属 / never act on another
    // user's album). Throws ALBUM_NOT_FOUND / ALBUM_NOT_OWNED.
    await albumService.findOwned(user.id, uuid);
    const slice = await parseBody(BodySchema, req);
    const result = await agentClient.recommendV3({ albumId: uuid, ...slice });
    return ok(result);
  } catch (e) {
    return fromException(e);
  }
}
