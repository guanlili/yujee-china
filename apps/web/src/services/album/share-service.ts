import { randomBytes } from 'node:crypto';
import { loadStoryDraft } from './draft-store';
import { db, type DbOrTx } from '@/db/client';
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
import type { Album, AlbumShare } from '@/db/schema';

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

/** 把相册当前页面组装成快照页形状。分享冻结与 admin 只读预览共用同一份 —— 两处各写
 *  一遍的话,「草稿优先、定稿回退」这条规则迟早在一边漂掉。
 *
 *  页面来源:编辑态页真相在 draft_pages 行(2026-08-03 拆表;loadStoryDraft 对未播种的
 *  存量书回退 legacy draftJson.pages)。冻结读不烘(bake:false)—— 页面字节原样进快照。
 *  定稿相册才在 album_pages。优先草稿,回退定稿。 */
export async function buildSnapshotPages(
  album: Album,
  tx: DbOrTx,
): Promise<AlbumShare['snapshotJson']['pages']> {
  const draft = await loadStoryDraft(album, { tx, bake: false });
  const draftPages = draft?.pages ?? [];
  if (draftPages.length > 0) {
    return draftPages.map((p) => ({
      pageIndex: p.pageIndex,
      templateId: p.templateId,
      imagesJson: p.images,
      textsJson: p.texts,
      imagePosJson: p.imagePos ?? {},
      ...(p.html ? { htmlJson: p.html } : {}),
    }));
  }
  const finalized = await albumPageRepo.findByAlbum(tx, album.id);
  return finalized.map((p) => ({
    pageIndex: p.pageIndex,
    templateId: p.templateId,
    imagesJson: p.imagesJson as Record<string, string>,
    textsJson: p.textsJson as Record<string, string>,
    imagePosJson: p.imagePosJson as Record<string, { x: number; y: number; scale: number }>,
  }));
}

export const shareService = {
  // 生成分享(collab rework §3.1):校验归属 → 把当前定稿页数据 + 每张照片的「公开
  // 快照 URL」冻结为 album_shares 的**新行**(独立 token,一链接一行)。重新生成不再
  // 覆盖旧行,旧链接继续可读 —— 协同下 editor 建分享不会撤销 owner 已发的链接,
  // 且失败的生成对已有链接零副作用(插入而非覆盖)。
  // 分享页用 FlipBook 按这套数据渲染真翻书;图片走公开快照 URL,免登也能显示
  // (本地原图不参与:别人浏览器里没有你的 IndexedDB)。
  // Ownership, current pages/filter/snapshot versions, validation, and the insert
  // all share one album-row lock.
  async createShare(userId: string, albumId: string, locale: string): Promise<{ token: string }> {
    return db.transaction(async (tx) => {
      const album = await albumRepo.findByIdForUpdate(tx, albumId);
      if (!album) throw ERRORS.ALBUM_NOT_FOUND();
      if (album.userId !== userId) throw ERRORS.ALBUM_NOT_OWNED();

      // 页面来源:编辑态页真相在 draft_pages 行(2026-08-03 拆表;loadStoryDraft 对未
      // 播种的存量书回退 legacy draftJson.pages)。冻结读在行锁事务内且不烘
      // (bake:false)—— 页面字节原样进快照。定稿相册才在 album_pages。优先草稿,回退定稿。
      const snapshotPages = await buildSnapshotPages(album, tx);
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
      await albumShareRepo.create(tx, {
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
