'use client';

// 照片原图上传的浏览器侧封装:签名 → 直传 R2 → confirm。
// docs/plans/2026-08-02-photo-originals-r2.md 中的 HTTP 端点实现(Task 4)的封装。

export type PhotoOriginalUploadEntry = {
  photoId: string;
  width: number;
  height: number;
  bytes: number;
};

export type SignedPhotoOriginalUpload = {
  photoId: string;
  putUrl: string;
  r2Key: string;
};

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: unknown; error?: { message?: string } } | null;
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error?.message ?? `request failed (${res.status})`);
  }
  return json.data;
}

export function signPhotoOriginalUpload(
  albumId: string,
  entries: PhotoOriginalUploadEntry[],
): Promise<SignedPhotoOriginalUpload[]> {
  return postJson(`/api/v1/albums/${albumId}/photo-originals/upload-url`, { entries }) as Promise<
    SignedPhotoOriginalUpload[]
  >;
}

export function confirmPhotoOriginals(
  albumId: string,
  input: { entries?: PhotoOriginalUploadEntry[]; missing?: string[] },
): Promise<{ uploaded: number; missing: number }> {
  return postJson(`/api/v1/albums/${albumId}/photo-originals`, input) as Promise<
    { uploaded: number; missing: number }
  >;
}

export function fetchPhotoOriginalUrls(
  albumId: string,
  photoIds: string[],
): Promise<Record<string, string>> {
  return postJson(`/api/v1/albums/${albumId}/photo-originals/urls`, { photoIds }) as Promise<
    Record<string, string>
  >;
}

// 直传一张原图到 R2 的签名 PUT。content-type 必须与签名时一致(image/jpeg)。
export async function putPhotoOriginalBlob(putUrl: string, blob: Blob): Promise<void> {
  const res = await fetch(putUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: blob,
  });
  if (!res.ok) throw new Error(`photo original PUT failed (${res.status})`);
}
