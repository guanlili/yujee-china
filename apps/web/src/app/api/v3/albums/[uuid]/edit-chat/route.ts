import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';
import { V3AnalyzeImageDataUrl, V3EditChatRequest } from '@yujee/contracts';

const BodySchema = V3EditChatRequest.pick({
  language: true,
  userMessage: true,
})
  .extend({
    chapterId: z.string().min(1).optional(),
    focusedPageIndex: z.number().int().nonnegative().optional(),
    pagePhotoRefs: z.record(z.string(), V3AnalyzeImageDataUrl).optional(),
  })
  .strict();

export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const result = await albumService.editChatTurn(user.id, uuid, {
      language: body.language,
      ...(body.chapterId ? { chapterId: body.chapterId } : {}),
      userMessage: body.userMessage,
      ...(body.focusedPageIndex !== undefined ? { focusedPageIndex: body.focusedPageIndex } : {}),
      ...(body.pagePhotoRefs ? { pagePhotoRefs: body.pagePhotoRefs } : {}),
    });
    return ok(result);
  } catch (e) {
    return fromException(e);
  }
}
