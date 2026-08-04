'use client';

// 手动照片备份(photo-snapshot-design.md)的浏览器侧封装:签名 → 直传 R2 → confirm。
// 原图不上传;上传的是 display 档压缩图(photoStore.getTierBlob)。mirror PDF/封面直传。

import type { SnapshotEntry } from '@/services/album/photo-snapshot-util';
import { UnauthorizedError } from '@/lib/generation/client';

export type { SnapshotEntry };

export type SignedSnapshotUpload = SnapshotEntry & {
  putUrl: string;
  r2Key: string;
  publicUrl: string;
};

export type ConfirmedPhotoSnapshot = {
  photoIds: string[];
  renderVersions: Record<string, string>;
};

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: unknown; error?: { code?: string; message?: string } } | null;
  if (!res.ok || !json?.ok) {
    // 会话过期/游客碰真实账号专属能力:类型化抛出,调用方(保存/分享)引导去登录,
    // 不再糊一个含混的 request failed。
    if (res.status === 401 || json?.error?.code === 'UNAUTHORIZED' || json?.error?.code === 'ANON_UPGRADE_REQUIRED') {
      throw new UnauthorizedError();
    }
    throw new Error(json?.error?.message ?? `request failed (${res.status})`);
  }
  return json.data;
}

export function signPhotoSnapshotUpload(
  albumId: string,
  entries: SnapshotEntry[],
): Promise<SignedSnapshotUpload[]> {
  return postJson(`/api/v1/albums/${albumId}/photo-snapshot-upload-url`, { entries }) as Promise<
    SignedSnapshotUpload[]
  >;
}

export function confirmPhotoSnapshot(
  albumId: string,
  entries: SnapshotEntry[],
): Promise<ConfirmedPhotoSnapshot> {
  return postJson(`/api/v1/albums/${albumId}/photo-snapshot`, { entries }) as Promise<
    ConfirmedPhotoSnapshot
  >;
}

// 直传一张压缩图到 R2 的签名 PUT。content-type 必须与签名时一致(image/jpeg)。
export async function putSnapshotBlob(putUrl: string, blob: Blob): Promise<void> {
  const res = await fetch(putUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: blob,
  });
  if (!res.ok) throw new Error(`snapshot PUT failed (${res.status})`);
}
