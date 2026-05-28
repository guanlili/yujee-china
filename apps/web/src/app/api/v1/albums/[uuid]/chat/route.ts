import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { chatService } from '@/services/chat/chat-service';

const BodySchema = z.object({
  message: z.string().min(1).max(500),
  language: z.enum(['zh', 'en']),
});

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const data = await chatService.edit(user.id, uuid, body.message, body.language);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
