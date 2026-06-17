import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';

const BodySchema = z.object({
  contentType: z.literal('image/jpeg'),
  size: z.number().int().positive(),
});

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const data = await albumService.signCoverThumbnailUpload(user.id, uuid, body);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
