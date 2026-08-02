// Pure logic for photo originals (original photos uploaded by user), split out of
// album-service so validation / key derivation / url-derivation are unit-testable
// without a DB or R2. The service methods are thin wrappers over these.

import { z } from 'zod';
import { ERRORS } from '@/lib/api/error-codes';
import { isValidPhotoId } from './photo-snapshot-util';

export const PHOTO_ORIGINAL_CONTENT_TYPE = 'image/jpeg';
export const PHOTO_ORIGINAL_MAX_COUNT = 300;

export const PhotoOriginalEntrySchema = z.object({
  photoId: z.string().refine(isValidPhotoId, 'invalid photoId'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive().max(30 * 1024 * 1024, 'bytes exceeds 30MB'),
}).strict();

export type PhotoOriginalEntry = z.infer<typeof PhotoOriginalEntrySchema>;

export const PhotoOriginalEntriesSchema = z.array(PhotoOriginalEntrySchema)
  .min(1)
  .max(PHOTO_ORIGINAL_MAX_COUNT)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      if (seen.has(entry.photoId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'photoId'],
          message: 'duplicate photoId',
        });
      }
      seen.add(entry.photoId);
    });
  });

export const PhotoOriginalEntriesBodySchema = z.object({
  entries: PhotoOriginalEntriesSchema,
}).strict();

// Variant for ConfirmBodySchema: allows empty array (min 0) to enable semantics where
// only missing is required when entries is omitted or empty.
const PhotoOriginalEntriesSchemaForConfirm = z.array(PhotoOriginalEntrySchema)
  .max(PHOTO_ORIGINAL_MAX_COUNT)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      if (seen.has(entry.photoId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'photoId'],
          message: 'duplicate photoId',
        });
      }
      seen.add(entry.photoId);
    });
  });

export const PhotoOriginalConfirmBodySchema = z.object({
  entries: PhotoOriginalEntriesSchemaForConfirm.optional(),
  missing: z.array(z.string().refine(isValidPhotoId, 'invalid photoId')).optional(),
}).strict().superRefine((data, ctx) => {
  // At least one of entries or missing must be non-empty
  const hasEntries = data.entries && data.entries.length > 0;
  const hasMissing = data.missing && data.missing.length > 0;
  if (!hasEntries && !hasMissing) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'at least one of entries or missing must be non-empty',
    });
  }

  // Combined count must not exceed max
  const totalCount = (data.entries?.length ?? 0) + (data.missing?.length ?? 0);
  if (totalCount > PHOTO_ORIGINAL_MAX_COUNT) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `combined entries and missing count exceeds ${PHOTO_ORIGINAL_MAX_COUNT}`,
    });
  }

  // Check for duplicate photoIds across both entries and missing
  const allIds = new Set<string>();
  const duplicates = new Set<string>();

  data.entries?.forEach((entry) => {
    if (allIds.has(entry.photoId)) {
      duplicates.add(entry.photoId);
    }
    allIds.add(entry.photoId);
  });

  data.missing?.forEach((id) => {
    if (allIds.has(id)) {
      duplicates.add(id);
    }
    allIds.add(id);
  });

  if (duplicates.size > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `duplicate photoIds found: ${Array.from(duplicates).join(', ')}`,
    });
  }
});

export const PhotoOriginalUrlsBodySchema = z.object({
  photoIds: z.array(z.string().refine(isValidPhotoId, 'invalid photoId'))
    .min(1)
    .max(PHOTO_ORIGINAL_MAX_COUNT),
}).strict();

export function photoOriginalKey(albumId: string, photoId: string): string {
  if (!isValidPhotoId(photoId)) {
    throw ERRORS.VALIDATION_FAILED('invalid photoId');
  }
  return `photo-originals/${albumId}/${photoId}.jpg`;
}
