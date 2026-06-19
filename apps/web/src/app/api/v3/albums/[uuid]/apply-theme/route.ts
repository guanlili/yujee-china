import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';
import { agentClient } from '@/lib/agent/agent-client';
import { V3ApplyThemeRequest } from '@yujee/contracts';
import { buildApplyThemeAgentRequests, combineApplyThemeResponses } from './route-utils';

// Browser-facing apply-theme body (③ 主题/章节色-应用, WP3.2 #190). After the user
// picks per-chapter {accentColor, artFont} (from /v3/recommend), the browser sends the
// selected theme + per-chapter choices + the current flat pages (§8.3 ③④传相关页).
// albumId comes from the URL, so it is stripped from the forwarded body's source of
// truth. The agent is stateless and deterministic (no model): it 一键刷 every
// variableDecor 槽 (含 SVG) and returns a page-level layoutPatch (§3 树边界: 仍是页级).
// Web is the sole truth source: it then writes the chapter color/font into the tree +
// advances stage theme → cover (§8.3 stage 推进权在 Web), and hands the patch back for
// the browser to apply live.
const BodySchema = V3ApplyThemeRequest.omit({ albumId: true });

// POST /api/v3/albums/[uuid]/apply-theme — synchronous (§8). 60s budget.
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    // Ownership gate before any agent call (§3 数据归属 / never act on another
    // user's album). Throws ALBUM_NOT_FOUND / ALBUM_NOT_OWNED.
    await albumService.findOwned(user.id, uuid);
    const slice = await parseBody(BodySchema, req);

    // Deterministic agent brush of the variableDecor slots (含 SVG). The flat Page
    // contract carries no chapterId, so split by the Web-owned draft skeleton and
    // send one chapter's related pages per Agent call.
    const agentPayloads = buildApplyThemeAgentRequests(
      { albumId: uuid, ...slice },
      await albumService.getDraftSkeleton(user.id, uuid),
    );
    const result = combineApplyThemeResponses(
      await Promise.all(agentPayloads.map((payload) => agentClient.applyThemeV3(payload))),
    );

    // Persist: write the per-chapter color/font into the tree + advance stage=cover.
    // The agent's layoutPatch is handed back for the browser to apply live (pages are
    // re-derived at finalize, not stored in draft_json).
    const persisted = await albumService.applyTheme(
      user.id,
      uuid,
      slice.chapters,
      result.layoutPatch,
    );

    return ok({
      layoutPatch: persisted.layoutPatch,
      stage: persisted.stage,
      assistantReply: result.assistantReply,
      usage: result.usage,
    });
  } catch (e) {
    return fromException(e);
  }
}
