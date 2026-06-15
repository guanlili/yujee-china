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

// No prompt: the rerun reuses the stored album.prompt as the promptHint (§6.5.3).
// The browser resends base64 (invariant 1) under a fresh requestId. In v2 a FAILED
// card always reruns init (Stage 1+3) — finalize failures roll back to EDITING and
// retry from the editor, never landing here.
//
// No `takenAt`: unlike the first init (POST /api/v2/albums accepts EXIF takenAt for
// the time-ordered story), retry rebuilds from the persisted recipe, which stores
// only photoIds — photosFromStore cannot recover EXIF. So a retried init groups
// without the timeline (same as the original v1 retry). If timeline-faithful retry
// is wanted, persist takenAt in the recipe and thread it through here.
const BodySchema = z.object({
  requestId: z.string().uuid(),
  language: z.enum(['zh', 'en']),
  photos: z.array(PhotoSchema).min(1).max(30),
});

// Same cross-region base64 forward as POST /api/v2/albums — give the Fly submit room.
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const data = await generationService.retryV2(user.id, uuid, body);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
