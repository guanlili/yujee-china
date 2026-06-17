import { z } from 'zod';

export const PhotoOrientation = z.enum(['portrait', 'landscape', 'square']);
export const PhotoQuality = z.enum(['hero', 'detail', 'fill']);

export const Magazine = z.object({
  title: z.string().min(1).max(60),
  subtitle: z.string().max(100).optional(),
  style: z.string(),
  language: z.enum(['zh', 'en']),
});

export const PhotoAnalysis = z.object({
  photoId: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  quality: PhotoQuality,
  orientation: PhotoOrientation,
});

// #165 per-slot position/scale override. Mirrors @yujee/contracts ImagePos and
// the Python schema; this web-side copy is the inv-9 validation point for the
// finalize/add callbacks, so the agent's imagePos survives into album_pages.
export const ImagePos = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  scale: z.number().min(1).max(2),
});

export const Page = z.object({
  pageIndex: z.number().int().nonnegative(),
  templateId: z.string(),
  images: z.record(z.string(), z.string()),
  texts: z.record(z.string(), z.string()),
  // Optional per-slot position/scale overrides. Absent => render default 50/50/1.
  imagePos: z.record(z.string(), ImagePos).optional(),
});

export const AlbumLayoutPlan = z.object({
  magazine: Magazine,
  photos: z.array(PhotoAnalysis),
  pages: z.array(Page).min(1),
});

export type AlbumLayoutPlanT = z.infer<typeof AlbumLayoutPlan>;
export type PageT = z.infer<typeof Page>;
export type ImagePosT = z.infer<typeof ImagePos>;
export type PhotoAnalysisT = z.infer<typeof PhotoAnalysis>;
export type MagazineT = z.infer<typeof Magazine>;
