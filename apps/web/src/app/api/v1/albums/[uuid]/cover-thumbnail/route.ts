import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';

// #167: confirm the browser finished the direct R2 PUT of the cover thumbnail.
// Mirrors the pdf confirm route.
const BodySchema = z.object({ r2Key: z.string().min(1) });

export async function PUT(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const data = await albumService.confirmCoverThumbnail(user.id, uuid, body.r2Key);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
