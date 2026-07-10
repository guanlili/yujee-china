import { z } from 'zod';
import { CJK_FONT_IDS } from '@/services/font/font-manifest';

const CjkFontIdSchema = z.enum(CJK_FONT_IDS);

export const FontSubsetBodySchema = z.object({
  charset: z.string().min(1).max(5000),
  fontIds: z.array(CjkFontIdSchema)
    .max(3)
    .refine((ids) => new Set(ids).size === ids.length, 'fontIds must be unique')
    .default([]),
}).strict();
