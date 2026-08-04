import { z } from 'zod';
import { getAuthUser } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { generationService } from '@/services/generation/generation-service';
import { MAX_PHOTOS_PER_GENERATION } from '@/config/pricing';
import { V3Language } from '@yujee/contracts';

// POST /api/v3/albums/[uuid]/add-photos — 加照片增量重跑(spec §1)。浏览器只发新照片
// (压缩 base64 + 时间/聚类信号),服务端 hold 积分并转发 engine analyze;后续采访/排版
// 复用既有链路。402 = 积分不足;不可编辑/在途追加 = ALBUM_NOT_EDITABLE。
export const maxDuration = 60;

const AddPhotosBodySchema = z
  .object({
    requestId: z.string().min(1),
    language: V3Language,
    photos: z
      .array(
        z
          .object({
            photoId: z.string().min(1),
            base64: z.string().min(1),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
            takenAt: z.string().nullable().optional(),
            clusterId: z.string().nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_PHOTOS_PER_GENERATION),
  })
  .strict();

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await getAuthUser(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(AddPhotosBodySchema, req);
    const result = await generationService.submitAddPhotosV3(user.id, uuid, body, {
      isAnonymous: user.isAnonymous,
    });
    return ok(result);
  } catch (e) {
    return fromException(e);
  }
}
