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

  // 解耦后 select-layout 是独立 layout job(自己的 requestId,浏览器不知道)。唯一调用方
  // album-service.getStoryProgress 靠这个查询判断「排版是否还在跑」(QUEUED/RUNNING 即
  // running),不取 job 本身的字段 —— uq_agent_jobs_album_kind_active 保证每 album 至多
  // 一条活跃 layout job,查到即视为在跑。
  findActiveLayoutByAlbum: async (albumId: string): Promise<AgentJob | undefined> => {
    const rows = await db
      .select()
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.albumId, albumId),
          eq(agentJobs.kind, 'layout'),
          inArray(agentJobs.status, ['QUEUED', 'RUNNING']),
        ),
      )
      .orderBy(desc(agentJobs.createdAt), desc(agentJobs.id))
      .limit(1);
    return rows[0];
  },

  // 成稿续跑:某 album 是否有在跑的 compose job(QUEUED/RUNNING)。唯一调用方
  // album-service.listCoverSets 用它判断「成稿还在跑」—— 刷新重进时不重复弹封面选择卡。
  // uq_agent_jobs_album_kind_active 保证每 album 至多一条活跃 compose job。
  findActiveComposeByAlbum: async (albumId: string): Promise<AgentJob | undefined> => {
    const rows = await db
      .select()
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.albumId, albumId),
          eq(agentJobs.kind, 'compose'),
          inArray(agentJobs.status, ['QUEUED', 'RUNNING']),
        ),
      )
      .orderBy(desc(agentJobs.createdAt), desc(agentJobs.id))
      .limit(1);
    return rows[0];
  },

  // 排版续跑止血:某 album 最近一条 layout job,**不限 status**(含 FAILED/COMPLETED)。
  // findActiveLayoutByAlbum 只取在跑的(QUEUED/RUNNING),看不到"上次排版失败/跑完了";
  // getStoryProgress 先看 active(→'running'),没有再看这条最近的(FAILED→'failed'),
  // 让 ChatPanel 重进时能区分"还在排/失败要重排/没排过"。排序与 findActiveLayoutByAlbum
  // 一致(createdAt desc, id 破平)。
  findLatestLayoutByAlbum: async (albumId: string): Promise<AgentJob | undefined> => {
    const rows = await db
      .select()
      .from(agentJobs)
      .where(and(eq(agentJobs.albumId, albumId), eq(agentJobs.kind, 'layout')))
      .orderBy(desc(agentJobs.createdAt), desc(agentJobs.id))
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

  reserveSelectLayout: async (tx: DbOrTx, id: string): Promise<boolean> => {
    const rows = await tx
      .update(agentJobs)
      .set({ progress: 51, startedAt: new Date() })
      .where(
        and(
          eq(agentJobs.id, id),
          eq(agentJobs.status, 'RUNNING'),
          eq(agentJobs.stage, 'layout'),
          eq(agentJobs.progress, 50),
        ),
      )
      .returning({ id: agentJobs.id });
    return rows.length > 0;
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
