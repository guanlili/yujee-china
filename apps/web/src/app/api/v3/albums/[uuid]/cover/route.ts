import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';
import { agentClient } from '@/lib/agent/agent-client';
import { V3CoverRequest } from '@yujee/contracts';
import { toBrowserCoverPatch } from './route-utils';

// Browser-facing cover body (④ 书籍设计 — 封面/封尾, WP4.1 #192). The user (optionally)
// picks a 封面/封尾 system template; the browser sends the selected template ids + the
// relevant pages (§8.3 ③④传相关页). albumId comes from the URL, so it is stripped from
// the forwarded body's source of truth. The agent is stateless and deterministic (no
// model): it auto-fills the cover/ending pages and returns a page-level layoutPatch (§3
// 树边界: 仍是页级) — or an EMPTY patch when the user skipped (§4.4 跳过=空, never an
// error). Web is the sole truth source: it then advances stage cover → ready (§8.3 stage
// 推进权在 Web) and hands the patch back for the browser to apply live.
const BodySchema = V3CoverRequest.omit({ albumId: true });

// POST /api/v3/albums/[uuid]/cover — synchronous (§8). 60s budget.
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    // Ownership gate before any agent call (§3 数据归属 / never act on another user's
    // album). Throws ALBUM_NOT_FOUND / ALBUM_NOT_OWNED.
    await albumService.findOwned(user.id, uuid);
    const slice = await parseBody(BodySchema, req);

    // Deterministic agent auto-fill of the chosen 封面/封尾 pages (empty when skipped).
    const result = await agentClient.coverV3({ albumId: uuid, ...slice });

    // Persist: advance stage cover → ready (stage 推进权在 Web). The agent's layoutPatch
    // is handed back for the browser to apply live (pages are re-derived at finalize, not
    // stored in draft_json — cover/ending design is page-level, §3 树边界).
    const persisted = await albumService.cover(user.id, uuid, result.layoutPatch);

    return ok({
      layoutPatch: toBrowserCoverPatch(persisted.layoutPatch),
      stage: persisted.stage,
      assistantReply: result.assistantReply,
      usage: result.usage,
    });
  } catch (e) {
    return fromException(e);
  }
}
