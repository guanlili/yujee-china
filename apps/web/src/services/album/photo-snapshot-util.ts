// Pure logic for the manual photo backup (photo-snapshot-design.md), split out of
// album-service so validation / key derivation / merge / url-derivation are
// unit-testable without a DB or R2. The service methods are thin wrappers over these.

// 手动备份一次最多带多少张(防滥用);一本书用到的照片数远小于此。
export const PHOTO_SNAPSHOT_MAX_COUNT = 300;

// photoId = crypto.randomUUID()(见 HeroComposer)。进 R2 key 前必须收紧字符集,
// 杜绝路径穿越 `../` 或跨 {userId}/{albumId} 命名空间。
const PHOTO_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export function isValidPhotoId(id: unknown): id is string {
  return typeof id === 'string' && PHOTO_ID_RE.test(id);
}

// R2 key 约定,mirror `cover-thumbs/{userId}/{albumId}.jpg`。
export function photoSnapshotKey(userId: string, albumId: string, photoId: string): string {
  return `photo-snapshots/${userId}/${albumId}/${photoId}.jpg`;
}

// 合并已备份集合:去重、保持稳定插入序(已有在前,新增在后)。
export function mergeSnapshotPhotoIds(
  existing: string[] | undefined,
  incoming: string[],
): string[] {
  const set = new Set(existing ?? []);
  for (const id of incoming) set.add(id);
  return [...set];
}

// photoId → 公开 URL(按约定 key 推导)。publicUrl 注入以便无 R2 env 单测。
export function photoSnapshotUrls(
  userId: string,
  albumId: string,
  photoIds: string[] | undefined,
  publicUrl: (key: string) => string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of photoIds ?? []) {
    if (isValidPhotoId(id)) out[id] = publicUrl(photoSnapshotKey(userId, albumId, id));
  }
  return out;
}
