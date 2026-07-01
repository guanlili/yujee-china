import { z } from 'zod';

import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';

// 内容采集(分组后采访)写回:浏览器把每章采访答案拼成的 chapterContext 发上来,Web 写进
// draft_json.tree(§3 数据归属:authoring tree 不经浏览器往返,浏览器只发它拼好的答案字符串)。
// PRIVACY:chapterContext 只含地名文字 + 用户原话,坐标绝不在其中(坐标止步于浏览器聚类,
// 见 lib/photo/geocode.ts)。可跳过的章不必出现在数组里(缺省保持 "")。
const BodySchema = z
  .object({
    contexts: z
      .array(
        z
          .object({
            chapterId: z.string().min(1),
            chapterContext: z.string().max(500),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

// POST /api/v3/albums/[uuid]/chapter-context — synchronous. 纯 draft 写回,不调 Agent。
export const maxDuration = 30;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    // Ownership gate + draft write live inside the service (§3 数据归属).
    // Throws ALBUM_NOT_FOUND / ALBUM_NOT_OWNED / VALIDATION_FAILED.
    const result = await albumService.saveChapterContexts(user.id, uuid, body.contexts);
    return ok(result);
  } catch (e) {
    return fromException(e);
  }
}
