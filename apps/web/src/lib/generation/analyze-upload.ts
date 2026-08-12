// 建书照片直传 R2(绕开 Vercel 4.5MB 请求体上限)。纯逻辑、依赖全注入(sign/put
// 都是函数参数),不碰 DOM/fetch/IndexedDB,可在 node:test 下直接单测;真实绑定在
// lib/generation/client.ts。
//
// 为什么存在:建书曾经把每张 800px 预览的 base64 塞进一个 JSON body 一次性 POST,
// 27~50 张就会撞上 Vercel 的 FUNCTION_PAYLOAD_TOO_LARGE(413),而且 413 的响应体是
// text/plain,客户端 res.json() 直接抛 SyntaxError —— 用户看到的是一句乱码。现在字节
// 走预签名 PUT 直达 R2,建书请求只带 photoId。
//
// 这里绝不静默丢照片:任何一张没传上去都会出现在 failedPhotoIds 里,由调用方决定是
// 报错还是征询用户。旧的 onFiles 只 console.warn,用户根本不知道少了图。

export type AnalyzeUploadDeps = {
  // 一次换回整批的预签名 PUT。整批失败就是整批失败(抛出),不做部分降级 ——
  // 一张都没传的情况必须让调用方看见,而不是伪装成"全部失败"。
  sign: (
    photoIds: string[],
  ) => Promise<{ sessionId: string; uploads: { photoId: string; putUrl: string }[] }>;
  put: (putUrl: string, blob: Blob) => Promise<void>;
};

export type AnalyzeUploadResult = {
  sessionId: string;
  /** 确实落进 R2 的 photoId,按传入顺序。 */
  uploadedPhotoIds: string[];
  /** 重试用尽仍未落地、或签名响应里根本没回来的 photoId,按传入顺序。 */
  failedPhotoIds: string[];
};

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_CONCURRENCY = 3;

// 简单的并发工作池:同一时刻至多 `limit` 个 worker 在跑。worker 自己吞掉失败,
// 这里不需要再兜一层。(与 lib/album/photo-original-sync.ts 同款形状。)
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

export async function uploadAnalyzePreviews(input: {
  photos: { photoId: string; blob: Blob }[];
  deps: AnalyzeUploadDeps;
  onProgress?: (done: number, total: number) => void;
  attemptsPerPhoto?: number;
  concurrency?: number;
}): Promise<AnalyzeUploadResult> {
  const { photos, deps, onProgress } = input;
  const attempts = input.attemptsPerPhoto ?? DEFAULT_ATTEMPTS;
  const concurrency = input.concurrency ?? DEFAULT_CONCURRENCY;
  const total = photos.length;

  const { sessionId, uploads } = await deps.sign(photos.map((p) => p.photoId));
  const putUrlByPhotoId = new Map(uploads.map((u) => [u.photoId, u.putUrl] as const));

  // 按输入下标记结果,最后再按序展开 —— 并发下完成顺序不等于传入顺序。
  const ok = new Array<boolean>(total).fill(false);
  let done = 0;
  onProgress?.(done, total);

  await runWithConcurrency(photos, concurrency, async (photo, index) => {
    const putUrl = putUrlByPhotoId.get(photo.photoId);
    // 签名响应漏了这张(理论上不该发生):记失败,不当作传成功。
    if (putUrl) {
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          await deps.put(putUrl, photo.blob);
          ok[index] = true;
          break;
        } catch {
          // 最后一次也失败就留在 ok[index]=false,由下面归入 failedPhotoIds。
        }
      }
    }
    done += 1;
    onProgress?.(done, total);
  });

  const uploadedPhotoIds: string[] = [];
  const failedPhotoIds: string[] = [];
  photos.forEach((photo, index) => {
    (ok[index] ? uploadedPhotoIds : failedPhotoIds).push(photo.photoId);
  });

  return { sessionId, uploadedPhotoIds, failedPhotoIds };
}
