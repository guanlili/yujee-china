import { db, type DbOrTx } from '@/db/client';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { albumPageRepo } from '@/db/repos/album-page-repo';
import { creditService } from '@/services/credit/credit-service';
import { ERRORS } from '@/lib/api/error-codes';
import { AlbumLayoutPlan, type AlbumLayoutPlanT } from '@/lib/agent/layout-schema';
import { logger } from '@/lib/log/logger';

export const jobService = {
  async create(tx: DbOrTx, input: { userId: string; albumId: string; requestId: string }) {
    const job = await agentJobRepo.create(tx, {
      userId: input.userId,
      albumId: input.albumId,
      requestId: input.requestId,
      status: 'QUEUED',
      progress: 0,
    });
    return job;
  },

  async markRunning(tx: DbOrTx, jobId: string) {
    await agentJobRepo.update(tx, jobId, { status: 'RUNNING', startedAt: new Date() });
  },

  async findStatus(userId: string, requestId: string) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) throw ERRORS.JOB_NOT_FOUND();
    if (job.userId !== userId) throw ERRORS.JOB_NOT_OWNED();
    return {
      requestId: job.requestId,
      albumId: job.albumId,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      error: job.error ?? null,
    };
  },

  async handleProgress(requestId: string, stage: string, progress: number) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) return; // idempotent: callback after completion can be dropped
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return;
    await agentJobRepo.update(db, job.id, {
      stage,
      progress,
      status: job.status === 'QUEUED' ? 'RUNNING' : job.status,
      startedAt: job.startedAt ?? new Date(),
    });
  },

  async handleCompleted(requestId: string, rawLayout: unknown, usage: unknown) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) return;
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return; // idempotent

    const parsed = AlbumLayoutPlan.safeParse(rawLayout);
    if (!parsed.success) {
      logger.error({ requestId, issues: parsed.error.issues }, 'agent layout invalid');
      await this.handleFailed(requestId, {
        code: 'AGENT_INVALID_OUTPUT',
        message: parsed.error.issues.map((i) => i.message).join('; '),
      });
      return;
    }
    const layout: AlbumLayoutPlanT = parsed.data;

    const album = await albumRepo.findById(job.albumId);
    if (!album) {
      logger.warn({ requestId, albumId: job.albumId }, 'album missing on completed');
      return;
    }

    await albumRepo.update(db, job.albumId, {
      title: layout.magazine.title,
      status: 'EDITING',
      layoutJson: layout,
      pageCount: layout.pages.length,
    });

    await albumPageRepo.bulkInsert(
      db,
      layout.pages.map((p) => ({
        albumId: job.albumId,
        pageIndex: p.pageIndex,
        templateId: p.templateId,
        imagesJson: p.images,
        textsJson: p.texts,
      })),
    );

    if (album.creditHoldId) {
      await creditService.settle(db, job.userId, album.creditHoldId);
    }

    await agentJobRepo.update(db, job.id, {
      status: 'COMPLETED',
      progress: 100,
      stage: 'composing',
      usage: (usage as Record<string, unknown> | null) ?? null,
      completedAt: new Date(),
    });
  },

  async handleFailed(requestId: string, error: { code: string; message: string }) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) return;
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return; // idempotent

    await albumRepo.update(db, job.albumId, {
      status: 'FAILED',
      errorMessage: error.message,
    });

    await creditService.releaseByAlbum(db, job.albumId);

    await agentJobRepo.update(db, job.id, {
      status: 'FAILED',
      error,
      completedAt: new Date(),
    });
  },
};
