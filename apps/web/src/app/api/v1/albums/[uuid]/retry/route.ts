import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { generationService } from '@/services/generation/generation-service';

const PhotoSchema = z.object({
  photoId: z.string().min(1),
  base64: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

// No prompt: the rerun reuses the stored album.prompt (§6.5.3). The browser
// resends base64 (invariant 1) under a fresh requestId. Min 1 photo, aligned
// with CT-1 (§6.5.6): the Agent renders 1–2 photos with text-only layouts.
const BodySchema = z.object({
  requestId: z.string().uuid(),
  language: z.enum(['zh', 'en']),
  photos: z.array(PhotoSchema).min(1).max(30),
});

// Same cross-region base64 forward as POST /jobs — give the Fly submit room.
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const data = await generationService.retry(user.id, uuid, body);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
