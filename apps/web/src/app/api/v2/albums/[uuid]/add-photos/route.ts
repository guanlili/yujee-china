import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { generationService } from '@/services/generation/generation-service';
import { MAX_PHOTOS_PER_GENERATION } from '@/config/pricing';

// Browser-facing add-photos body (W11 mid-edit add). Same per-photo shape as init
// — the NEW photos only, base64 + the takenAt-only EXIF gate (D-GPS). The album is
// identified by the URL; the agent contract is assembled server-side.
const AddPhoto = z.object({
  photoId: z.string().min(1),
  base64: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  takenAt: z.string().datetime().nullable().optional(),
});

const BodySchema = z.object({
  requestId: z.string().uuid(),
  language: z.enum(['zh', 'en']),
  promptHint: z.string().max(500).optional(),
  photos: z.array(AddPhoto).min(1).max(MAX_PHOTOS_PER_GENERATION),
});

// Forwards a multi-MB base64 payload to the agent and waits for its 202; 60s gives
// the cross-region submit room (same as init).
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const data = await generationService.submitAddPhotosV2(user.id, uuid, body);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}

// Poll the add job by requestId. The editor calls this until status leaves
// 'running', then injects the new pages (completed) or surfaces the error (failed).
export async function GET(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const requestId = new URL(req.url).searchParams.get('requestId') ?? '';
    const data = await generationService.getAddStatus(user.id, uuid, requestId);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
