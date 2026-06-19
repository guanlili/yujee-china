import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';
import { V3CoverRequest } from '@yujee/contracts';
import { toBrowserCoverPatch } from './route-utils';

// Browser-facing cover body (④ 书籍设计 — 封面/封尾, WP4.1 #192 / 缺口#20). Invariant 12 /
// §3 数据归属: the authoring tree (layout pages) NEVER round-trips through the browser, so
// the browser sends only its SELECTIONS — the chosen 封面/封尾 template ids (null/absent =
// 跳过, 封面可选 §4.4). albumId comes from the URL. The Web service is the sole truth source
// for draft_json: it re-slices the relevant pages SERVER-SIDE (§8.3 ③④传相关页), runs the
// deterministic agent auto-fill (an EMPTY patch when skipped — never an error), folds the
// returned page-level patch into draft_json.pages + advances stage cover → ready (§8.3 stage
// 推进权在 Web), and hands the patch back for the browser to apply live.
const BodySchema = V3CoverRequest.pick({
  language: true,
  coverTemplateId: true,
  endingTemplateId: true,
}).strict();

// POST /api/v3/albums/[uuid]/cover — synchronous (§8). 60s budget.
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    // Ownership gate + draft re-slice + agent auto-fill + persist all live inside the
    // service (§3 数据归属). Throws ALBUM_NOT_FOUND / ALBUM_NOT_OWNED / VALIDATION_FAILED.
    const result = await albumService.coverTurn(user.id, uuid, body);

    return ok({
      // Map the agent's V3LayoutPatchEntry to the browser patch shape
      // (imagesJson/textsJson) applyPatchToPages expects.
      layoutPatch: toBrowserCoverPatch(result.layoutPatch),
      stage: result.stage,
      assistantReply: result.assistantReply,
    });
  } catch (e) {
    return fromException(e);
  }
}
