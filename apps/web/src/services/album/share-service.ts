import { randomBytes } from 'node:crypto';
import { albumService, readPreviewPages } from './album-service';
import { albumPageRepo } from '@/db/repos/album-page-repo';
import { albumShareRepo } from '@/db/repos/album-share-repo';
import { photoSnapshotUrls } from './photo-snapshot-util';
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

export const shareService = {
  // 生成/重新生成分享:校验归属 → 把当前定稿页数据 + 每张照片的「公开快照 URL」冻结进
  // album_shares(一相册一条,覆盖)。分享页用 FlipBook 按这套数据渲染真翻书;图片走公开
  // 快照 URL,免登也能显示(本地原图不参与:别人浏览器里没有你的 IndexedDB)。
  // 前置:调用方(浏览器)已把该相册照片全量传成公开快照;没传的图在分享页里会空。
  async createShare(userId: string, albumId: string, locale: string): Promise<{ token: string }> {
    const album = await albumService.findOwned(userId, albumId);
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
      const finalized = await albumPageRepo.findByAlbum(albumId);
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
    const photoUrls = photoSnapshotUrls(userId, albumId, album.photoSnapshot?.photoIds, r2.publicUrl);
    const token = newShareToken();
    await albumShareRepo.upsertByAlbum({
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
  },

  // 公开读:仅按 token 查,不校验归属(免登)。查不到 → null(路由 404)。
  async getPublicShare(token: string): Promise<PublicShare | null> {
    const share = await albumShareRepo.findByToken(token);
    if (!share) return null;
    return { title: share.title, snapshot: share.snapshotJson };
  },
};
