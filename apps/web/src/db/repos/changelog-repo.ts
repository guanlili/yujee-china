import { db } from '../client';
import { changelogEntries, users } from '../schema';
import { desc, eq, gt, and } from 'drizzle-orm';

export const CHANGELOG_CATEGORIES = ['feature', 'improvement', 'notice', 'fix'] as const;
export type ChangelogCategory = (typeof CHANGELOG_CATEGORIES)[number];

/** 公开端点:已发布条目按日期倒序(分页)。 */
export async function listPublished(limit = 50, offset = 0) {
  return db
    .select()
    .from(changelogEntries)
    .where(eq(changelogEntries.isPublished, true))
    .orderBy(desc(changelogEntries.publishedAt))
    .limit(limit)
    .offset(offset);
}

/** 管理后台:全部条目(含草稿)。 */
export async function listAll() {
  return db.select().from(changelogEntries).orderBy(desc(changelogEntries.publishedAt));
}

/** 未读数:比用户上次查看时间晚的已发布条目数。 */
export async function unreadCount(userId: string): Promise<number> {
  const [user] = await db
    .select({ lastSeen: users.changelogLastSeenAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user?.lastSeen) {
    // 从未看过:返回全部已发布数(首次全量提示)
    const all = await db
      .select({ id: changelogEntries.id })
      .from(changelogEntries)
      .where(eq(changelogEntries.isPublished, true));
    return all.length;
  }
  const unread = await db
    .select({ id: changelogEntries.id })
    .from(changelogEntries)
    .where(
      and(
        eq(changelogEntries.isPublished, true),
        gt(changelogEntries.publishedAt, user.lastSeen),
      ),
    );
  return unread.length;
}

/** 标记已读(水位推进到当前时间)。 */
export async function markSeen(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ changelogLastSeenAt: new Date() })
    .where(eq(users.id, userId));
}

/** CRUD(admin) */
export async function create(entry: {
  category: string;
  titleZh: string;
  titleEn: string;
  bodyZh: string;
  bodyEn: string;
  imageUrl?: string | null;
  isPublished: boolean;
  createdBy: string;
}) {
  const rows = await db.insert(changelogEntries).values(entry).returning();
  return rows[0];
}

export async function update(id: string, patch: Partial<{
  category: string;
  titleZh: string;
  titleEn: string;
  bodyZh: string;
  bodyEn: string;
  imageUrl: string | null;
  isPublished: boolean;
  publishedAt: Date;
}>): Promise<void> {
  await db
    .update(changelogEntries)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(changelogEntries.id, id));
}

export async function remove(id: string): Promise<void> {
  await db.delete(changelogEntries).where(eq(changelogEntries.id, id));
}
