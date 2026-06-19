import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';

// ② 章节故事完成度闸门(WP2.4 / §4.2(1)). The editor reads/writes the chapter-story
// gate here. stage 推进权在 Web (§8.3): confirming the last chapter advances
// albums.stage 'story' → 'theme' + unlocks export — the agent never touches stage.
//
// GET  → current gate state (stage / chapterOrder / doneChapterIds / currentChapterId
//        / allDone / exportUnlocked) for the breadcrumb + per-chapter ticks.
// POST → 确定本章 (一章一确定): mark one chapter done, advance the cursor; all done
//        flips stage to theme. Idempotent on re-confirm / after the gate opened.

const ConfirmSchema = z.object({ chapterId: z.string().min(1) }).strict();

export async function GET(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const data = await albumService.getStoryProgress(user.id, uuid);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const { chapterId } = await parseBody(ConfirmSchema, req);
    const data = await albumService.markChapterDone(user.id, uuid, chapterId);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
