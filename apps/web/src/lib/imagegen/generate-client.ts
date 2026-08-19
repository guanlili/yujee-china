// 浏览器侧编排:生成 -> 取签名 URL -> 下载 -> 落本地照片库。
//
// 为什么必须落本地库:生成图的字节在 R2,而展示层的 resolveImage 读的是浏览器
// 本地库(IndexedDB),回落只认「手动备份」那张表(album.photoSnapshotUrls),
// 生成图不在里面。少了最后一步,图槽会指向一张取不到的图 —— 用户看到的是空框。
//
// 依赖全注入,便于在 node:test 下直接测顺序和失败处置;真实绑定在 EditorPort 里。

export type GenerateImageRequest = {
  albumId: string;
  prompt: string;
  width: number;
  height: number;
  /** 续上一笔的免费重来;不传 = 新的一笔,要扣分。 */
  retryOf?: string;
};

export type GenerateImageResponse = {
  photoId: string;
  generationId: string;
  freeRetriesLeft: number;
  charged: boolean;
};

export type GenerateImageDeps = {
  postGenerate: (body: Record<string, unknown>) => Promise<GenerateImageResponse>;
  fetchUrls: (photoIds: string[]) => Promise<Record<string, string>>;
  fetchBlob: (url: string) => Promise<Blob>;
  storeBlob: (photoId: string, blob: Blob) => Promise<void>;
};

export async function generateImageIntoSlot(
  req: GenerateImageRequest,
  deps: GenerateImageDeps,
): Promise<GenerateImageResponse> {
  const result = await deps.postGenerate({
    prompt: req.prompt,
    width: req.width,
    height: req.height,
    ...(req.retryOf ? { retryOf: req.retryOf } : {}),
  });

  const urls = await deps.fetchUrls([result.photoId]);
  const url = urls[result.photoId];
  if (!url) throw new Error(`no signed url for generated photo ${result.photoId}`);

  // 下载失败就整个失败:宁可让用户重试,也不要把图槽指到一张取不到的图上。
  const blob = await deps.fetchBlob(url);
  await deps.storeBlob(result.photoId, blob);

  return result;
}
