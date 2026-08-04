import { getAuthUser } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { generationService } from '@/services/generation/generation-service';
import { BodySchema } from './schema';

// Browser-facing analyze body (五环节状态机 WP1.1). The full agent contract
// (V3AnalyzeRequest) is assembled server-side — the browser only owns the photo
// bytes, language, an optional prompt hint, and its idempotency requestId. takenAt
// is the ONLY EXIF field accepted (§3 隐私 / D-GPS: coordinates never enter).
// Forwards a multi-MB base64 payload to the agent and waits for its 202; 60s gives
// the cross-region submit room.
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const user = await getAuthUser(req);
    const body = await parseBody(BodySchema, req);
    const data = await generationService.submitAnalyzeV3(user.id, body, {
      isAnonymous: user.isAnonymous,
    });
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
