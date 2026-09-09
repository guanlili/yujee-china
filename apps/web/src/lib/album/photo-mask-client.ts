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
