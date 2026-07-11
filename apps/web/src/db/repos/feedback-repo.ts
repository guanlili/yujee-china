import { and, eq, gte, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import { feedback, type Feedback, type NewFeedback } from '../schema';

export const feedbackRepo = {
  create: async (tx: DbOrTx, input: NewFeedback): Promise<Feedback> => {
    const [row] = await tx.insert(feedback).values(input).returning();
    return row!;
  },

  // 限频依据:该用户 since 之后的反馈条数。
  countByUserSince: async (userId: string, since: Date): Promise<number> => {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedback)
      .where(and(eq(feedback.userId, userId), gte(feedback.createdAt, since)));
    return row?.count ?? 0;
  },
};
