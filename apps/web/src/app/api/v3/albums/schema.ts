import { z } from 'zod';
import { TakenAtDateTime, V3AnalyzeImageDataUrl } from '@yujee/contracts';
import { MAX_PHOTOS_PER_GENERATION } from '@/config/pricing';

const AnalyzePhoto = z.object({
  photoId: z.string().min(1),
  base64: V3AnalyzeImageDataUrl,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  takenAt: TakenAtDateTime.nullable().optional(),
}).strict();

export const BodySchema = z.object({
  requestId: z.string().uuid(),
  language: z.enum(['zh', 'en']),
  promptHint: z.string().max(500).optional(),
  photos: z.array(AnalyzePhoto).min(1).max(MAX_PHOTOS_PER_GENERATION),
}).strict();
