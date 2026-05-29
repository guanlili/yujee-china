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

const BodySchema = z.object({
  requestId: z.string().uuid(),
  prompt: z.string().min(1).max(500),
  language: z.enum(['zh', 'en']),
  photos: z.array(PhotoSchema).min(3).max(30),
});

// Forwards a multi-MB base64 payload to the Fly agent and waits for its 202.
// Vercel's default function cap can abort before the 30s agentClient timeout;
// 60s gives the cross-region submit room (Hobby allows up to 60).
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const user = await requireAuth(req);
    const body = await parseBody(BodySchema, req);
    const data = await generationService.submit(user.id, body);
    return ok(data);
  } catch (e) {
    return fromException(e);
  }
}
