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

export const Page = z.object({
  pageIndex: z.number().int().nonnegative(),
  templateId: z.string(),
  images: z.record(z.string(), z.string()),
  texts: z.record(z.string(), z.string()),
});

export const AlbumLayoutPlan = z.object({
  magazine: Magazine,
  photos: z.array(PhotoAnalysis),
  pages: z.array(Page).min(1),
});

export type AlbumLayoutPlanT = z.infer<typeof AlbumLayoutPlan>;
export type PageT = z.infer<typeof Page>;
export type PhotoAnalysisT = z.infer<typeof PhotoAnalysis>;
export type MagazineT = z.infer<typeof Magazine>;
