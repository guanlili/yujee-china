import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { generationService } from '@/services/generation/generation-service';
import { MAX_PHOTOS_PER_GENERATION } from '@/config/pricing';

// Browser-facing analyze body (五环节状态机 WP1.1). The full agent contract
// (V3AnalyzeRequest) is assembled server-side — the browser only owns the photo
// bytes, language, an optional prompt hint, and its idempotency requestId. takenAt
// is the ONLY EXIF field accepted (§3 隐私 / D-GPS: coordinates never enter).
const AnalyzePhoto = z.object({
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
  photos: z.array(AnalyzePhoto).min(1).max(MAX_PHOTOS_PER_GENERATION),
});

// Forwards a multi-MB base64 payload to the agent and waits for its 202; 60s gives
// the cross-region submit room.
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const user = await requireAuth(req);
    const body = await parseBody(BodySchema, req);
    const data = await generationService.submitAnalyzeV3(user.id, body);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
