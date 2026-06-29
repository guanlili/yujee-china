import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { generationService } from '@/services/generation/generation-service';
import { SelectLayoutBodySchema } from './schema';

// POST /api/v3/albums/[uuid]/select-layout — async Stage2 handoff. The browser
// sends only the existing analyze requestId plus its local 200px refs; Web owns
// the draft tree and callback URL.
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(SelectLayoutBodySchema, req);
    const result = await generationService.submitSelectLayoutV3(user.id, uuid, body);
    return ok(result);
  } catch (e) {
    return fromException(e);
  }
}
