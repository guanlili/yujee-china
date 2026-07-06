import { albumService } from '@/services/album/album-service';
import { albumMessageRepo } from '@/db/repos/album-message-repo';

export const chatService = {
  async listMessages(userId: string, albumId: string, limit = 50) {
    await albumService.findOwned(userId, albumId);
    const rows = await albumMessageRepo.findRecentByAlbum(albumId, limit);
    return {
      messages: rows.map((m) => ({
        id: m.id,
        seq: m.seq,
        role: m.role,
        content: m.content,
        layoutPatch: m.layoutPatch ?? null,
        chapterId: m.chapterId,
        createdAt: m.createdAt,
      })),
    };
  },
};
