import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';
import { V3Language } from '@yujee/contracts';

// Browser-facing finalize body (⑤ 待导出, WP5.1 #194). The browser sends ONLY its UI
// `language` scalar — the authoring tree is the server-side truth in draft_json and
// NEVER round-trips through the browser (invariant 12 / §8.3 全树只在 finalize 传一次),
// so the service reads the tree + pages itself. albumId comes from the URL. The agent
// is stateless + deterministic (no model): it flattens the tree + pages into the flat
// AlbumLayoutPlan (magazine+photos+pages[]), baking each chapter's accentColor/artFont
// (incl. the svg seam) into pages[].texts (§3 树边界: 渲染契约不加树形字段) and running
// the SINGLE validate (§6.8 第 7 条). finalize does NOT advance stage and never touches
// 积分 (§6.7); it is a pure read → flatten projection handed back for the browser to
// render the PDF locally.
const BodySchema = z.object({ language: V3Language }).strict();

// POST /api/v3/albums/[uuid]/finalize — synchronous (§8). 60s budget.
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const { language } = await parseBody(BodySchema, req);
    // Ownership + tree/pages read + deterministic flatten happen in the service
    // (§3 数据归属 / never act on another user's album).
    const result = await albumService.finalize(user.id, uuid, language);
    return ok(result);
  } catch (e) {
    return fromException(e);
  }
}
