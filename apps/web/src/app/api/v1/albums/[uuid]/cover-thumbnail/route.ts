import { z } from 'zod';
import { requireRealUser } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';

const BodySchema = z.object({
  r2Key: z.string().min(1),
  coverRevision: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export async function PUT(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireRealUser(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const data = await albumService.confirmCoverThumbnail(user.id, uuid, body);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
