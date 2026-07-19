import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';

// title 与 boardBackground 各自可选(至少给一项)。boardBackground: null = 清除垫底背景。
const BoardBackgroundSchema = z.union([
  z.object({ kind: z.literal('color'), color: z.string().max(9) }),
  z.object({ kind: z.literal('preset'), presetId: z.string().max(40) }),
  z.null(),
]);
const PatchSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    boardBackground: BoardBackgroundSchema.optional(),
  })
  .refine((b) => b.title !== undefined || b.boardBackground !== undefined, {
    message: 'nothing to update',
  });
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
    if (body.boardBackground !== undefined) {
      return albumService.updateBoardBackground(userId, uuid, body.boardBackground);
    }
    return albumService.updateTitle(userId, uuid, body.title!);
  });
}

export function DELETE(req: Request, ctx: RouteCtx) {
  return withAlbum(req, ctx, async (userId, uuid) => {
    await albumService.delete(userId, uuid);
    return { deleted: true };
  });
}
