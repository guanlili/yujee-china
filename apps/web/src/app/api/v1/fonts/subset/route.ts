import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { fontService } from '@/services/font/font-service';
import { FontSubsetBodySchema } from './schema';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const user = await requireAuth(req);
    const { charset, fontIds } = await parseBody(FontSubsetBodySchema, req);
    const { sans, serif, artFonts } = await fontService.subset(user.id, charset, fontIds);
    return ok({ sansBase64: sans, serifBase64: serif, artFonts });
  } catch (e) {
    return fromException(e);
  }
}
