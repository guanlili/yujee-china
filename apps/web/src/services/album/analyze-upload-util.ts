// 建书照片直传 R2 的纯逻辑(key 派生 + 入参校验),和 photo-original-util.ts /
// photo-snapshot-util.ts 同款分层:service 只是它的薄包装,这里不碰 DB/R2。
//
// 生命周期:analyze-uploads/ 下的对象只是「浏览器 → engine」之间的中转,建书发车后
// 就没用了。应用层**不**删它们 —— 用户中途放弃时不会有任何请求回来告诉我们该删,
// 而且每次重试都会换一个新 uploadSessionId(key 里带它),上一轮的对象当场变孤儿。
// 全靠 R2 上给 `analyze-uploads/` 前缀配的生命周期规则回收(建议 1 天过期)。
// 这条规则是**运维前置条件**,不是优化:没配就是无上限的存储成本。见 apps/web/README.md
// 的 Browser Data Boundary 一节。

import { z } from 'zod';
import { ERRORS } from '@/lib/api/error-codes';
import { MAX_PHOTOS_PER_GENERATION } from '@/config/pricing';
import { isValidPhotoId } from './photo-snapshot-util';

export const ANALYZE_UPLOAD_CONTENT_TYPE = 'image/jpeg';

// 单张上限,和旧内联路径的 V3AnalyzeImageDataUrl(≤800KB)对齐。预签名 PUT 本身
// 不带体积约束,所以这道闸必须在读回来的时候补上:否则一个 200MB 的对象会被整个
// 读进 serverless 函数内存,而且超大图会绕过 Web 层直接把 400 留给 engine ——
// 用户拿到的是一本 FAILED 的书,而不是一个干净的报错。
export const ANALYZE_UPLOAD_MAX_BYTES = 800 * 1024;

// sessionId 由服务端签发(见 newUploadSessionId),但客户端会把它原样回传给建书
// 请求,所以回来的时候必须重新校验形状 —— 它是 R2 key 的一段,放任就是路径穿越。
const UPLOAD_SESSION_ID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isValidUploadSessionId(value: unknown): value is string {
  return typeof value === 'string' && UPLOAD_SESSION_ID_RE.test(value);
}

export function newUploadSessionId(): string {
  return crypto.randomUUID();
}

export const UploadSessionId = z.string().refine(isValidUploadSessionId, 'invalid uploadSessionId');

export const AnalyzeUploadSignBodySchema = z.object({
  photoIds: z
    .array(z.string().refine(isValidPhotoId, 'invalid photoId'))
    .min(1)
    .max(MAX_PHOTOS_PER_GENERATION)
    .superRefine((ids, ctx) => {
      const seen = new Set<string>();
      ids.forEach((id, index) => {
        if (seen.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index],
            message: 'duplicate photoId',
          });
        }
        seen.add(id);
      });
    }),
}).strict();

export type AnalyzePhotoMeta = {
  photoId: string;
  width: number;
  height: number;
  takenAt?: string | null;
  clusterId?: string | null;
};

export type AssembledAnalyzePhoto = AnalyzePhotoMeta & { base64: string };

// R2 GET 的并发。字节都在同一个 region、每张只有几十 KB,3 已经够把 Vercel 函数
// 那 60s 的窗口用满还剩很多;再高只是给 R2 添堵。
const FETCH_CONCURRENCY = 3;

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const lane = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => lane()));
}

// 把浏览器直传到 R2 的 800px 预览取回来,拼成和「照片字节内联在 body 里」时代
// 一模一样的 data URL —— engine 侧因此一行都不用改。
//
// 少一张都不发车:photoCount 已经按客户端报的张数落库、积分也按它 hold 了,带着
// 窟窿把书生成出来比直接失败更糟。缺几张就抛 ANALYZE_UPLOAD_INCOMPLETE(409),
// 客户端补传那几张再来一次即可(同一个 requestId 幂等)。
export async function assembleAnalyzePhotos(input: {
  userId: string;
  sessionId: string;
  photos: AnalyzePhotoMeta[];
  fetchObject: (key: string) => Promise<Uint8Array | null>;
  concurrency?: number;
}): Promise<AssembledAnalyzePhoto[]> {
  const { userId, sessionId, photos, fetchObject } = input;
  const out = new Array<AssembledAnalyzePhoto | null>(photos.length).fill(null);

  await runWithConcurrency(photos, input.concurrency ?? FETCH_CONCURRENCY, async (photo, index) => {
    // fetchObject 的契约:对象不存在返回 null,其余一律抛。抛出来的原样上传 ——
    // 把 R2 故障(凭证过期/503/限流)伪装成「这张没传上来」会让用户反复重传一个
    // 永远好不了的东西,服务端还看不到任何信号。
    const bytes = await fetchObject(analyzeUploadKey(userId, sessionId, photo.photoId));
    if (!bytes) return;
    if (bytes.byteLength > ANALYZE_UPLOAD_MAX_BYTES) throw ERRORS.PHOTO_TOO_LARGE();
    out[index] = {
      photoId: photo.photoId,
      width: photo.width,
      height: photo.height,
      ...(photo.takenAt !== undefined ? { takenAt: photo.takenAt } : {}),
      ...(photo.clusterId !== undefined ? { clusterId: photo.clusterId } : {}),
      base64: `data:${ANALYZE_UPLOAD_CONTENT_TYPE};base64,${Buffer.from(bytes).toString('base64')}`,
    };
  });

  const missing = out.filter((p) => p === null).length;
  if (missing > 0) throw ERRORS.ANALYZE_UPLOAD_INCOMPLETE(missing);
  return out as AssembledAnalyzePhoto[];
}

export function analyzeUploadKey(userId: string, sessionId: string, photoId: string): string {
  if (!isValidUploadSessionId(sessionId)) {
    throw ERRORS.VALIDATION_FAILED('invalid uploadSessionId');
  }
  if (!isValidPhotoId(photoId)) {
    throw ERRORS.VALIDATION_FAILED('invalid photoId');
  }
  return `analyze-uploads/${userId}/${sessionId}/${photoId}.jpg`;
}
