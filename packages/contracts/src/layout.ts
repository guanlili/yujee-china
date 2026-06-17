import { z } from 'zod';

export const PhotoOrientation = z.enum(['portrait', 'landscape', 'square']);
export type PhotoOrientation = z.infer<typeof PhotoOrientation>;

export const PhotoQuality = z.enum(['hero', 'detail', 'fill']);
export type PhotoQuality = z.infer<typeof PhotoQuality>;

export const Magazine = z.object({
  title: z.string().min(1).max(60),
  subtitle: z.string().max(100).optional(),
  style: z.string().min(1),
  language: z.enum(['zh', 'en']),
});
export type Magazine = z.infer<typeof Magazine>;

/**
 * Subject focal point (#169) — the main subject's (face-first) center in the
 * ORIGINAL image, normalized to [0, 1] on each axis (x = left→right,
 * y = top→bottom). Same coordinate space as a CSS object-position fraction, so
 * `{x: focal.x*100, y: focal.y*100}` is a ready-made objectPosition %.
 * Optional; absent => callers fall back to the centered default 0.5/0.5.
 */
export const Focal = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
export type Focal = z.infer<typeof Focal>;

export const PhotoAnalysis = z.object({
  photoId: z.string().min(1),
  description: z.string(),
  tags: z.array(z.string()),
  quality: PhotoQuality,
  orientation: PhotoOrientation,
  // #169: subject focal point (0..1, face-first). Survives finalize so the flat
  // layout's default imagePos can center on the subject. Absent => 0.5/0.5.
  focal: Focal.optional(),
});
export type PhotoAnalysis = z.infer<typeof PhotoAnalysis>;

/**
 * Per-image render override (#165 Phase 1). Sibling to a page's image slot map:
 * keyed by the SAME slotId the page's `images` map uses (e.g. `image`,
 * `imageTop`, `cells[0].image`). Absent slot => renderer falls back to the
 * historical default (objectPosition 50% 50%, no zoom), so every album authored
 * before this field is byte-unchanged.
 *
 *   x, y  - object-position percentages, clamp range [0, 100] (default 50/50)
 *   scale - zoom factor, clamp range [1, 2] (default 1; web-only, PDF ignores >1)
 *
 * Clamp bounds are enforced by the writer (#165 Phase 3 adjust_image_position);
 * the schema guards the full range so a hand-rolled payload can't break render.
 */
export const ImagePos = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  scale: z.number().min(1).max(2),
});
export type ImagePos = z.infer<typeof ImagePos>;

export const Page = z.object({
  pageIndex: z.number().int().nonnegative(),
  templateId: z.string().min(1),
  images: z.record(z.string(), z.string()),
  texts: z.record(z.string(), z.string()),
  // Optional per-slot position/scale overrides. Absent => render default 50/50/1.
  imagePos: z.record(z.string(), ImagePos).optional(),
});
export type Page = z.infer<typeof Page>;

export const AlbumLayoutPlan = z.object({
  magazine: Magazine,
  photos: z.array(PhotoAnalysis),
  pages: z.array(Page).min(1),
});
export type AlbumLayoutPlan = z.infer<typeof AlbumLayoutPlan>;
