import { z } from 'zod';
import { TakenAtDateTime, V3AnalyzeImageDataUrl } from '@yujee/contracts';
import { MAX_PHOTOS_PER_GENERATION } from '@/config/pricing';
import { UploadSessionId } from '@/services/album/analyze-upload-util';
import { isValidPhotoId } from '@/services/album/photo-snapshot-util';

const AnalyzePhoto = z.object({
  // 收紧到 isValidPhotoId(/^[A-Za-z0-9-]{1,64}$/):新链路里 photoId 是 R2 key 的
  // 一段。photoId 一直是 crypto.randomUUID(),旧客户端不受影响。
  photoId: z.string().refine(isValidPhotoId, 'invalid photoId'),
  // 直传改造后不再内联字节。optional 只为兼容改造前那版还开着的浏览器标签页,
  // 属于过渡期字段 —— 见下面 superRefine 的两种模式,以及 README 里的删除计划。
  base64: V3AnalyzeImageDataUrl.optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  takenAt: TakenAtDateTime.nullable().optional(),
  // #232: opaque browser-derived spatio-temporal cluster label (c1/c2/…). The
  // .strict() body still rejects any lat/lng/place/location key — only this label
  // is permitted. nullish: legacy clients (no key) and un-clusterable (null) both ok.
  clusterId: z.string().min(1).nullish(),
}).strict();

// /retry 仍然把全书照片内联重发(这一期没改它)。它单独用这份严格 schema:
// base64 必填、不认 uploadSessionId —— 建书那份为了直传把 base64 放成 optional,
// 共用会顺手把 retry 的入参也放松掉,而 retryAnalyzeV3 下游是要字节的。
// 体积:海外 Vercel 时代曾撞 FUNCTION_PAYLOAD_TOO_LARGE(4.5MB);国内 docker 部署
// 已实测(2026-10-26)7.3MB body 完整通过解析、无任何体积上限,约束只剩积分检查。
// 真要治超大重试,最省事的走法是让它也读 R2(字节建书时已经在那儿了)。
export const RetryBodySchema = z.object({
  requestId: z.string().uuid(),
  language: z.enum(['zh', 'en']),
  promptHint: z.string().max(500).optional(),
  photos: z
    .array(AnalyzePhoto.extend({ base64: V3AnalyzeImageDataUrl }))
    .min(1)
    .max(MAX_PHOTOS_PER_GENERATION),
}).strict();

export const BodySchema = z.object({
  requestId: z.string().uuid(),
  language: z.enum(['zh', 'en']),
  promptHint: z.string().max(500).optional(),
  // 新链路:照片字节已由浏览器直传 R2,这里只带服务端签发的会话 id。
  uploadSessionId: UploadSessionId.optional(),
  photos: z.array(AnalyzePhoto).min(1).max(MAX_PHOTOS_PER_GENERATION),
}).strict().superRefine((body, ctx) => {
  const seen = new Set<string>();
  body.photos.forEach((photo, index) => {
    if (seen.has(photo.photoId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['photos', index, 'photoId'],
        message: 'duplicate photoId',
      });
    }
    seen.add(photo.photoId);
  });

  // 恰好一种模式。半截 body(一部分带 base64 一部分不带)会让 photoCount 与实际
  // 拿得到的字节对不上,宁可整单拒掉。
  const withBytes = body.photos.filter((p) => p.base64 !== undefined).length;
  if (body.uploadSessionId !== undefined) {
    if (withBytes > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['uploadSessionId'],
        message: 'uploadSessionId and inline base64 are mutually exclusive',
      });
    }
    return;
  }
  if (withBytes !== body.photos.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['uploadSessionId'],
      message: 'uploadSessionId is required when photos carry no inline base64',
    });
  }
});
