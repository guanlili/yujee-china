import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';
import { V3ApplyThemeRequest } from '@yujee/contracts';

// Browser-facing apply-theme body (③ 主题/章节色-应用, WP3.2 #190 / 缺口#20). Invariant 12 /
// §3 数据归属: the authoring tree (layout pages) NEVER round-trips through the browser, so
// the browser sends only its SELECTIONS — the chosen theme + per-chapter {accentColor,
// artFont}. albumId comes from the URL. The Web service is the sole truth source for
// draft_json: it re-slices each chapter's themable pages SERVER-SIDE (§8.3 ③④传相关页),
// runs the deterministic agent brush (一键刷 variableDecor 槽, 含 SVG), writes the chapter
// color/font into the tree + advances stage theme → cover (§8.3 stage 推进权在 Web), and
// hands the page-level layoutPatch back for the browser to apply live.
const BodySchema = V3ApplyThemeRequest.pick({
  language: true,
  theme: true,
  chapters: true,
}).strict();

// POST /api/v3/albums/[uuid]/apply-theme — synchronous (§8). 60s budget.
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    // Ownership gate + draft re-slice + agent brush + persist all live inside the service
    // (§3 数据归属). Throws ALBUM_NOT_FOUND / ALBUM_NOT_OWNED / VALIDATION_FAILED.
    const result = await albumService.applyThemeTurn(user.id, uuid, body);
    return ok(result);
  } catch (e) {
    return fromException(e);
  }
}
