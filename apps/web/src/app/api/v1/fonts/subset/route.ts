import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { fontService } from '@/services/font/font-service';

export const runtime = 'nodejs';

const BodySchema = z.object({
  charset: z.string().min(1).max(5000),
});

export async function POST(req: Request) {
  try {
    const user = await requireAuth(req);
    const { charset } = await parseBody(BodySchema, req);
    const { sans, serif } = await fontService.subset(user.id, charset);
    return ok({ sansBase64: sans, serifBase64: serif });
  } catch (e) {
    return fromException(e);
  }
}
