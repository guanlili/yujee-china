// Pure logic for the manual photo backup (photo-snapshot-design.md), split out of
// album-service so validation / key derivation / merge / url-derivation are
// unit-testable without a DB or R2. The service methods are thin wrappers over these.

import { z } from 'zod';

// 手动备份一次最多带多少张(防滥用);一本书用到的照片数远小于此。
export const PHOTO_SNAPSHOT_MAX_COUNT = 300;

// photoId = crypto.randomUUID()(见 HeroComposer)。进 R2 key 前必须收紧字符集,
// 杜绝路径穿越 `../` 或跨 {userId}/{albumId} 命名空间。
const PHOTO_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export function isValidPhotoId(id: unknown): id is string {
  return typeof id === 'string' && PHOTO_ID_RE.test(id);
}

// `__cut1` 是抠图尾段(见 lib/photo/filter-state.ts)。刻意做成可选后缀而不是升
// pf-v2 —— 存量版本串因此逐字节不变,已分享的相册不会集体撞 409。
// 字符类 [a-z0-9-] 不含下划线,所以 lutId 不会贪婪吃掉 `__cut1`,结构无需改写。
const RENDER_VERSION_RE = /^pf-v1__[a-z0-9-]+(?:__(?:0|5|[1-9][0-9]|100))?(?:__cut1)?$/;

// 抠图产物带 alpha,JPEG 装不下。用有损 WebP 而不是 PNG:3400px 的抠图 PNG 动辄
// 5-15MB,WebP 与 JPEG 同量级,R2 存储和流量差一个数量级。
const CUTOUT_SUFFIX = '__cut1';
function snapshotExt(renderVersion: string): 'jpg' | 'webp' {
  return renderVersion.endsWith(CUTOUT_SUFFIX) ? 'webp' : 'jpg';
}

export function isValidRenderVersion(value: unknown): value is string {
  return typeof value === 'string' && RENDER_VERSION_RE.test(value);
}

export const SnapshotEntrySchema = z.object({
  photoId: z.string().refine(isValidPhotoId, 'invalid photoId'),
  renderVersion: z.string().regex(RENDER_VERSION_RE, 'invalid renderVersion'),
}).strict();

export type SnapshotEntry = z.infer<typeof SnapshotEntrySchema>;

export const SnapshotEntriesSchema = z.array(SnapshotEntrySchema)
  .min(1)
  .max(PHOTO_SNAPSHOT_MAX_COUNT)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      if (seen.has(entry.photoId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'photoId'],
          message: 'duplicate photoId',
        });
      }
      seen.add(entry.photoId);
    });
  });

export const SnapshotEntriesBodySchema = z.object({
  entries: SnapshotEntriesSchema,
}).strict();

// New writes use immutable per-render keys. The optional legacy branch exists only
// for historical rows confirmed before renderVersions were recorded.
export function photoSnapshotKey(
  userId: string,
  albumId: string,
  photoId: string,
  renderVersion?: string,
): string {
  if (renderVersion !== undefined && !isValidRenderVersion(renderVersion)) {
    throw new Error('invalid renderVersion');
  }
  return renderVersion
    ? `photo-snapshots/${userId}/${albumId}/${photoId}/${renderVersion}.${snapshotExt(renderVersion)}`
    : `photo-snapshots/${userId}/${albumId}/${photoId}.jpg`;
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

// Partial confirmation merge: existing-first photo order, while an incoming
// version replaces only that photo's recorded version.
export function mergePhotoSnapshot(
  existingPhotoIds: string[] | undefined,
  existingRenderVersions: Record<string, string> | undefined,
  incoming: SnapshotEntry[],
): { photoIds: string[]; renderVersions: Record<string, string> } {
  const photoIds = mergeSnapshotPhotoIds(
    existingPhotoIds,
    incoming.map((entry) => entry.photoId),
  );
  const renderVersions = { ...(existingRenderVersions ?? {}) };
  for (const entry of incoming) renderVersions[entry.photoId] = entry.renderVersion;
  return { photoIds, renderVersions };
}

// Only expose valid versions that correspond to a valid recorded photo. Corrupt
// historical JSON is treated as legacy by URL resolution and never reaches a key.
export function photoSnapshotRenderVersions(
  photoIds: string[] | undefined,
  renderVersions: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const photoId of photoIds ?? []) {
    const renderVersion = renderVersions?.[photoId];
    if (isValidPhotoId(photoId) && isValidRenderVersion(renderVersion)) {
      out[photoId] = renderVersion;
    }
  }
  return out;
}

// photoId → 公开 URL(按约定 key 推导)。publicUrl 注入以便无 R2 env 单测。
export function photoSnapshotUrls(
  userId: string,
  albumId: string,
  photoIds: string[] | undefined,
  publicUrl: (key: string) => string,
  renderVersions?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of photoIds ?? []) {
    if (!isValidPhotoId(id)) continue;
    const renderVersion = renderVersions?.[id];
    out[id] = publicUrl(
      photoSnapshotKey(
        userId,
        albumId,
        id,
        isValidRenderVersion(renderVersion) ? renderVersion : undefined,
      ),
    );
  }
  return out;
}
