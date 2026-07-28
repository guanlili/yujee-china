import { randomBytes } from 'node:crypto';
import { readPreviewPages } from './album-service';
import { db } from '@/db/client';
import { albumRepo } from '@/db/repos/album-repo';
import { albumPageRepo } from '@/db/repos/album-page-repo';
import { albumShareRepo } from '@/db/repos/album-share-repo';
import {
  isValidPhotoId,
  photoSnapshotKey,
  photoSnapshotRenderVersions,
} from './photo-snapshot-util';
import { effectiveRenderVersion } from '@/lib/photo/filter-state';
import { r2 } from '@/lib/r2/r2-client';
import { ERRORS } from '@/lib/api/error-codes';
import type { AlbumShare } from '@/db/schema';

// 随机不可猜的分享令牌:18 字节 → 24 位 URL-safe 字符。
function newShareToken(): string {
  return randomBytes(18).toString('base64url');
}

export type PublicShare = {
  title: string;
  snapshot: AlbumShare['snapshotJson'];
};

function referencedPhotoIds(pages: AlbumShare['snapshotJson']['pages']): string[] {
  const ids = new Set<string>();
  for (const page of pages) {
    for (const value of Object.values(page.imagesJson)) {
      if (value === '') continue;
      if (!isValidPhotoId(value)) {
        throw ERRORS.VALIDATION_FAILED('相册页面包含无效照片引用');
      }
      ids.add(value);
    }
  }
  return [...ids];
}

export const shareService = {
  // 生成/重新生成分享:校验归属 → 把当前定稿页数据 + 每张照片的「公开快照 URL」冻结进
  // album_shares(一相册一条,覆盖)。分享页用 FlipBook 按这套数据渲染真翻书;图片走公开
  // 快照 URL,免登也能显示(本地原图不参与:别人浏览器里没有你的 IndexedDB)。
  // Ownership, current pages/filter/snapshot versions, validation, and upsert all
  // share one album-row lock. A failed regeneration therefore cannot overwrite an
  // older valid token/snapshot.
  async createShare(userId: string, albumId: string, locale: string): Promise<{ token: string }> {
    return db.transaction(async (tx) => {
      const album = await albumRepo.findByIdForUpdate(tx, albumId);
      if (!album) throw ERRORS.ALBUM_NOT_FOUND();
      if (album.userId !== userId) throw ERRORS.ALBUM_NOT_OWNED();

      // 页面来源:编辑态相册页在 draft_json.pages(V3Page:images/texts/html);
      // 定稿相册才在 album_pages。优先草稿,回退定稿。统一映射成 EditorPage 形状。
      const draftPages = readPreviewPages(album.draftJson);
      let snapshotPages: AlbumShare['snapshotJson']['pages'];
      if (draftPages && draftPages.length > 0) {
        snapshotPages = draftPages.map((p) => ({
          pageIndex: p.pageIndex,
          templateId: p.templateId,
          imagesJson: p.images,
          textsJson: p.texts,
          imagePosJson: p.imagePos ?? {},
          ...(p.html ? { htmlJson: p.html } : {}),
        }));
      } else {
        const finalized = await albumPageRepo.findByAlbum(tx, albumId);
        snapshotPages = finalized.map((p) => ({
          pageIndex: p.pageIndex,
          templateId: p.templateId,
          imagesJson: p.imagesJson as Record<string, string>,
          textsJson: p.textsJson as Record<string, string>,
          imagePosJson: p.imagePosJson as Record<string, { x: number; y: number; scale: number }>,
        }));
      }
      if (snapshotPages.length === 0) {
        throw ERRORS.VALIDATION_FAILED('相册还没有可分享的页面');
      }

      const photoIds = referencedPhotoIds(snapshotPages);
      const recordedVersions = photoSnapshotRenderVersions(
        album.photoSnapshot?.photoIds,
        album.photoSnapshot?.renderVersions,
      );
      const missingCount = photoIds.reduce(
        (count, photoId) =>
          recordedVersions[photoId] === effectiveRenderVersion(album.photoFilter, photoId)
            ? count
            : count + 1,
        0,
      );
      if (missingCount > 0) {
        throw ERRORS.PHOTO_SNAPSHOT_VERSION_MISSING(missingCount);
      }

      // Every referenced ID has an exact valid version after the gate above, so
      // this path never derives a legacy unversioned key.
      const photoUrls = Object.fromEntries(
        photoIds.map((photoId) => [
          photoId,
          r2.publicUrl(
            photoSnapshotKey(userId, albumId, photoId, recordedVersions[photoId]!),
          ),
        ]),
      );
      const token = newShareToken();
      await albumShareRepo.upsertByAlbum(tx, {
        token,
        albumId,
        title: album.title,
        snapshotJson: {
          pages: snapshotPages,
          photoUrls,
          boardBackground: album.boardBackground ?? null,
          locale,
        },
      });
      return { token };
    });
  },

  // 公开读:仅按 token 查,不校验归属(免登)。查不到 → null(路由 404)。
  async getPublicShare(token: string): Promise<PublicShare | null> {
    const share = await albumShareRepo.findByToken(token);
    if (!share) return null;
    return { title: share.title, snapshot: share.snapshotJson };
  },
};
