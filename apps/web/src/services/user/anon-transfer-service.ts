import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { albums, agentJobs, albumMessages } from '@/db/schema';
import { logger } from '@/lib/log/logger';

// 匿名账号转正:把匿名期产生的行整体过户给真实账号。anonymous 插件的 onLinkAccount
// 在「删除匿名用户」之前调用(dist/plugins/anonymous/index.mjs:140-152),这里不搬的
// 行会被 schema 里 11 处 onDelete:'cascade' 连锅端 —— albums/agent_jobs/album_messages
// 三张带 userId 的业务表必须先改指真实账号。
// 刻意不搬的:credit_*(匿名零积分变动,无行可搬)、sessions/accounts(better-auth
// 自己的,随匿名用户删除是正确行为)、draft_pages.updatedBy(无 FK 的审计文本,留旧
// id 无害)。photo-snapshots R2 key 含 userId,但匿名阶段零 R2 写入,无需迁移对象。
export const anonTransferService = {
  async transfer(anonUserId: string, realUserId: string): Promise<{ albums: number }> {
    return db.transaction(async (tx) => {
      const moved = await tx
        .update(albums)
        .set({ userId: realUserId, updatedAt: new Date() })
        .where(eq(albums.userId, anonUserId))
        .returning({ id: albums.id });
      await tx.update(agentJobs).set({ userId: realUserId }).where(eq(agentJobs.userId, anonUserId));
      await tx
        .update(albumMessages)
        .set({ userId: realUserId })
        .where(eq(albumMessages.userId, anonUserId));
      logger.info(
        { anonUserId, realUserId, albums: moved.length },
        'anon account linked; albums transferred',
      );
      return { albums: moved.length };
    });
  },
};
