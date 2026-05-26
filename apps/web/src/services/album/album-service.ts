import { db, type DB } from '@/db/client';
import { albumRepo } from '@/db/repos/album-repo';
import { albumPageRepo } from '@/db/repos/album-page-repo';
import { ERRORS } from '@/lib/api/error-codes';

export const albumService = {
  async create(tx: DB, input: {
    userId: string;
    prompt: string;
    photoCount: number;
    title: string;
  }): Promise<{ albumId: string }> {
    const album = await albumRepo.create(tx, {
      userId: input.userId,
      title: input.title,
      prompt: input.prompt,
      photoCount: input.photoCount,
      status: 'AGENT_RUNNING',
      pageCount: 0,
    });
    return { albumId: album.id };
  },

  async findOwned(userId: string, albumId: string) {
    const album = await albumRepo.findById(albumId);
    if (!album) throw ERRORS.ALBUM_NOT_FOUND();
    if (album.userId !== userId) throw ERRORS.ALBUM_NOT_OWNED();
    return album;
  },

  async getDetail(userId: string, albumId: string) {
    const album = await this.findOwned(userId, albumId);
    const pages = await albumPageRepo.findByAlbum(albumId);
    return {
      album: {
        id: album.id,
        title: album.title,
        status: album.status,
        prompt: album.prompt,
        layoutJson: album.layoutJson ? JSON.parse(album.layoutJson) : null,
        photoCount: album.photoCount,
        pageCount: album.pageCount,
        pdfUrl: album.pdfUrl,
        errorMessage: album.errorMessage,
        createdAt: album.createdAt,
      },
      pages: pages.map((p) => ({
        pageIndex: p.pageIndex,
        templateId: p.templateId,
        imagesJson: JSON.parse(p.imagesJson),
        textsJson: JSON.parse(p.textsJson),
      })),
    };
  },

  async listByUser(userId: string) {
    const rows = await albumRepo.findByUser(userId);
    return rows.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      photoCount: a.photoCount,
      pageCount: a.pageCount,
      pdfUrl: a.pdfUrl,
      createdAt: a.createdAt,
    }));
  },
};

export const albumDB = db;
