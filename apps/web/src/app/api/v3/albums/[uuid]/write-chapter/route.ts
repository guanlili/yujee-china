import { z } from 'zod';

import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';

// 采访完一次性写满整章文案(§流程重构)。浏览器采访完调这里,Web 从 draft 切本章
// (含 chapterContext + 已定版式的 pages)转发 Agent /v3/write-chapter,回 pagesTexts
// 合并进 draft.pages。浏览器只发 chapterId + language,不发 tree(§3 数据归属)。
const BodySchema = z
  .object({
    language: z.enum(['zh', 'en']),
    chapterId: z.string().min(1),
  })
  .strict();

// POST /api/v3/albums/[uuid]/write-chapter — synchronous. 60s(整章写文案一次 LLM 调用)。
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const result = await albumService.writeChapterTurn(user.id, uuid, body);
    return ok(result);
  } catch (e) {
    return fromException(e);
  }
}
