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

/** 抠图 mask 的 content-type。服务端(isnet)回来的就是一张 PNG。 */
export const PHOTO_MASK_CONTENT_TYPE = 'image/png';

/**
 * 抠图 mask 的 R2 key。与原图同一套推导规则:**key 一律由 (albumId, photoId) 算出来**,
 * 任何调用方都给不了 key —— 内部口的鉴权只有一把共享密钥,收 key 等于把它升格成
 * 整桶任意对象的读写权。
 *
 * 不带 renderVersion:mask 是照片的固有属性(主体在哪),与 LUT/强度无关;
 * 重跑分割就地覆盖,`profile.maskKey` 始终指向同一个 key。
 */
export function photoMaskKey(albumId: string, photoId: string): string {
  if (!isValidPhotoId(photoId)) {
    throw ERRORS.VALIDATION_FAILED('invalid photoId');
  }
  return `photo-masks/${albumId}/${photoId}.png`;
}

export function photoOriginalKey(albumId: string, photoId: string): string {
  if (!isValidPhotoId(photoId)) {
    throw ERRORS.VALIDATION_FAILED('invalid photoId');
  }
  return `photo-originals/${albumId}/${photoId}.jpg`;
}
