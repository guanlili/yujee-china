import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';

const PatchSchema = z.object({ title: z.string().min(1).max(120) });
type RouteCtx = { params: Promise<{ uuid: string }> };
async function withAlbum<T>(
  req: Request,
  ctx: RouteCtx,
  action: (userId: string, uuid: string) => Promise<T>,
) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    return ok(await action(user.id, uuid));
  } catch (e) {
    return fromException(e);
  }
}

export function GET(req: Request, ctx: RouteCtx) {
  return withAlbum(req, ctx, (userId, uuid) => albumService.getDetail(userId, uuid));
}

export function PATCH(req: Request, ctx: RouteCtx) {
  return withAlbum(req, ctx, async (userId, uuid) => {
    const body = await parseBody(PatchSchema, req);
    return albumService.updateTitle(userId, uuid, body.title);
  });
}

export function DELETE(req: Request, ctx: RouteCtx) {
  return withAlbum(req, ctx, async (userId, uuid) => {
    await albumService.delete(userId, uuid);
    return { deleted: true };
  });
}
