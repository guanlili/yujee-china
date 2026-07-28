import { z } from 'zod';
import { PhotoFilterStateSchema } from '@/lib/photo/filter-state';

const BoardBackgroundSchema = z.union([
  z.object({ kind: z.literal('color'), color: z.string().max(9) }).strict(),
  z.object({ kind: z.literal('preset'), presetId: z.string().max(40) }).strict(),
  z.object({ kind: z.literal('upload'), key: z.string().max(64) }).strict(),
  z.null(),
]);

export const AlbumPatchSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    boardBackground: BoardBackgroundSchema.optional(),
    photoFilter: PhotoFilterStateSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (body) =>
      [body.title, body.boardBackground, body.photoFilter].filter(
        (value) => value !== undefined,
      ).length === 1,
    { message: 'exactly one field must be updated' },
  );
