import { and, desc, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
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

  // Row-locked read (SELECT ... FOR UPDATE) — callers re-validate state under the
  // lock so a concurrent progress heartbeat / callback either lands before (seen
  // fresh) or serializes behind (then no-ops). Must run inside a transaction.
  findByIdForUpdate: async (tx: DbOrTx, id: string): Promise<AgentJob | undefined> => {
    const rows = await tx
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.id, id))
      .for('update')
      .limit(1);
    return rows[0];
  },

  findByRequestId: async (requestId: string): Promise<AgentJob | undefined> => {
    const rows = await db
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.requestId, requestId))
      .limit(1);
    return rows[0];
  },

  // Newest job for an album. The album-uuid read path (album-service) uses this
  // to surface live stage/progress and to run the opportunistic zombie sweep —
  // album is the source of truth, the job is just its generation telemetry.
  findLatestByAlbum: async (albumId: string): Promise<AgentJob | undefined> => {
    const rows = await db
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.albumId, albumId))
      .orderBy(desc(agentJobs.createdAt), desc(agentJobs.id)) // id breaks createdAt ties
      .limit(1);
    return rows[0];
  },

  // Non-terminal jobs with no activity past `olderThan`. startedAt is refreshed
  // on every progress callback (a liveness heartbeat), so for RUNNING this means
  // "no progress since olderThan", not "started before olderThan". QUEUED has no
  // startedAt, judged by createdAt — so a job the Agent never accepted (and the
  // user abandoned) still gets failed + its credit released by the daily cron,
  // not only by the read-path sweep.
  findStaleRunning: async (olderThan: Date): Promise<AgentJob[]> =>
    db
      .select()
      .from(agentJobs)
      .where(
        or(
          and(
            eq(agentJobs.status, 'RUNNING'),
            isNotNull(agentJobs.startedAt),
            lt(agentJobs.startedAt, olderThan),
          ),
          and(eq(agentJobs.status, 'QUEUED'), lt(agentJobs.createdAt, olderThan)),
        ),
      ),

  create: async (tx: DbOrTx, data: NewAgentJob): Promise<AgentJob> => {
    const rows = await tx.insert(agentJobs).values(data).returning();
    return rows[0]!;
  },

  update: async (tx: DbOrTx, id: string, patch: Partial<NewAgentJob>): Promise<void> => {
    await tx.update(agentJobs).set(patch).where(eq(agentJobs.id, id));
  },

  // Conditional terminal transition: flip status to `to` only if it is currently
  // one of `from`, and report whether *this* call won. The job row is the single
  // arbiter when terminal callback handling and the read-path / daily-cron
  // sweepStaleJob race the same job: exactly one wins the UPDATE (row lock
  // serializes them), the losers get 0 rows and must not touch the album / credit
  // hold. Prevents a late sweep clobbering a just-completed album, or a late
  // callback resurrecting a released one.
  transitionStatus: async (
    tx: DbOrTx,
    id: string,
    to: AgentJobStatus,
    from: AgentJobStatus[],
    patch: Partial<NewAgentJob> = {},
  ): Promise<boolean> => {
    const rows = await tx
      .update(agentJobs)
      .set({ status: to, ...patch })
      .where(and(eq(agentJobs.id, id), inArray(agentJobs.status, from)))
      .returning({ id: agentJobs.id });
    return rows.length > 0;
  },
};
