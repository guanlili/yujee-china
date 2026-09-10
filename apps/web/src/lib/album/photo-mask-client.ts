'use client';

// 抠图 mask 的浏览器侧取数。与 photo-original-client 同一套写法:POST photoIds,
// 拿回签名 GET(TTL 300s);没有 mask 的照片**不会出现在结果里**。

export async function fetchPhotoMaskUrls(
  albumId: string,
  photoIds: string[],
): Promise<Record<string, string>> {
  const res = await fetch(`/api/v1/albums/${albumId}/photo-masks/urls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ photoIds }),
  });
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; data?: Record<string, string> }
    | null;
  if (!res.ok || !json?.ok || !json.data) return {};
  return json.data;
}

/**
 * 请服务端把「现在开着抠图但还没 mask」的那批补上。photoIds 由服务端从
 * `albums.photo_filter.cutouts` 自己读,这里不带清单。
 *
 * 调用方一律**不等**它(fire-and-forget):isnet 单张 ~4s。失败一律吞成空结果 ——
 * 拿不到 mask 只是抠图退回浏览器端,不该让编辑器里冒出错误。
 */
export async function requestCutoutMasks(albumId: string): Promise<{ created: string[] }> {
  try {
    const res = await fetch(`/api/v1/albums/${albumId}/photo-masks`, { method: 'POST' });
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; data?: { created?: unknown } }
      | null;
    if (!res.ok || !json?.ok || !Array.isArray(json.data?.created)) return { created: [] };
    return { created: json.data.created.filter((id): id is string => typeof id === 'string') };
  } catch {
    return { created: [] };
  }
}
