import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import { agentJobs, type AgentJob, type NewAgentJob } from '../schema';

type AgentJobStatus = AgentJob['status'];

export const agentJobRepo = {
  countByStatus: async (): Promise<{ status: AgentJobStatus; count: number }[]> =>
    db
      .select({ status: agentJobs.status, count: sql<number>`count(*)::int` })
      .from(agentJobs)
      .groupBy(agentJobs.status),

  countStuckRunning: async (cutoff: Date): Promise<number> => {
    const rows = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.status, 'RUNNING'),
          isNotNull(agentJobs.startedAt),
          lt(agentJobs.startedAt, cutoff),
        ),
      );
    return rows[0]?.total ?? 0;
  },

  findByRequestId: async (requestId: string): Promise<AgentJob | undefined> => {
    const rows = await db
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.requestId, requestId))
      .limit(1);
    return rows[0];
  },

  findStaleRunning: async (olderThan: Date): Promise<AgentJob[]> =>
    db
      .select()
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.status, 'RUNNING'),
          isNotNull(agentJobs.startedAt),
          lt(agentJobs.startedAt, olderThan),
        ),
      ),

  create: async (tx: DbOrTx, data: NewAgentJob): Promise<AgentJob> => {
    const rows = await tx.insert(agentJobs).values(data).returning();
    return rows[0]!;
  },

  update: async (tx: DbOrTx, id: string, patch: Partial<NewAgentJob>): Promise<void> => {
    await tx.update(agentJobs).set(patch).where(eq(agentJobs.id, id));
  },
};
