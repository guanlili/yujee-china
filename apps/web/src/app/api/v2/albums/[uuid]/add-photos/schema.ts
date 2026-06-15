import { z } from 'zod';
import { MAX_PHOTOS_PER_GENERATION } from '@/config/pricing';

const AddPhoto = z.object({
  photoId: z.string().min(1),
  base64: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  takenAt: z.string().datetime().nullable().optional(),
});

export const BodySchema = z.object({
  requestId: z.string().uuid(),
  language: z.enum(['zh', 'en']),
  promptHint: z.string().max(500).optional(),
  photos: z.array(AddPhoto).min(1).max(MAX_PHOTOS_PER_GENERATION),
});
