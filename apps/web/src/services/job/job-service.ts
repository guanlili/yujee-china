import { db, type DbOrTx } from '@/db/client';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { creditService } from '@/services/credit/credit-service';
import { ERRORS, mapAgentErrorCode } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';
import { transientLayoutCandidates } from '@/services/album/layout-candidates';
import { V3StoryDraft, type SelectLayoutCandidateUnit } from '@yujee/contracts';

// P2 select-layout progress sentinels on the shared agent_jobs row (stage stays
// 'layout' the whole time, see docs/agent/contract.md §5.2.1):
//   50  analyze done, awaiting browser select-layout dispatch (phase 1)
//   51  select-layout dispatched (reserveSelectLayout)
//   52  candidates callback arrived, awaiting browser judge-layout dispatch (phase 2)
//   53  judge-layout dispatched (reserveJudgeLayout)
//   100 completed
export const SELECT_LAYOUT_CANDIDATES_READY_PROGRESS = 52;

const ZOMBIE_TIMEOUT_MS = 5 * 60 * 1000;
const SELECT_LAYOUT_COMPLETABLE_STAGES = new Set(['layout', 'legalize', 'wrap']);

export type GenerationResolution =
  | { kind: 'progress'; stage: string | null; progress: number }
  | { kind: 'swept' }
  | null;

function firstChapterId(tree: unknown): string | null {
  if (!tree || typeof tree !== 'object' || Array.isArray(tree)) return null;
  const chapters = (tree as { chapters?: unknown }).chapters;
  if (!Array.isArray(chapters)) return null;
  const first = chapters[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) return null;
  const chapterId = (first as { chapterId?: unknown }).chapterId;
  return typeof chapterId === 'string' && chapterId.length > 0 ? chapterId : null;
}

export function buildAnalyzeDraftJson(tree: unknown) {
  return {
    version: 'v3-story',
    tree,
    progress: { currentChapterId: firstChapterId(tree), doneChapterIds: [] },
  };
}

export function mergeSelectLayoutPages(draftJson: unknown, pages: unknown) {
  const parsed = V3StoryDraft.safeParse(draftJson);
  if (!parsed.success) {
    throw ERRORS.VALIDATION_FAILED('select-layout completion requires an existing v3-story draft');
  }
  return { ...parsed.data, pages };
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function mergeV3Usage(previous: unknown, next: unknown): Record<string, unknown> {
  const prev = recordOrEmpty(previous);
  const cur = recordOrEmpty(next);
  const prevModels = recordOrEmpty(prev.models);
  const curModels = recordOrEmpty(cur.models);
  const out: Record<string, unknown> = {
    durationMs: numberValue(prev, 'durationMs') + numberValue(cur, 'durationMs'),
    visionCallCount: numberValue(prev, 'visionCallCount') + numberValue(cur, 'visionCallCount'),
    geminiCallCount: numberValue(prev, 'geminiCallCount') + numberValue(cur, 'geminiCallCount'),
    planningInputTokens:
      numberValue(prev, 'planningInputTokens') + numberValue(cur, 'planningInputTokens'),
    planningOutputTokens:
      numberValue(prev, 'planningOutputTokens') + numberValue(cur, 'planningOutputTokens'),
    repairAttempts: numberValue(prev, 'repairAttempts') + numberValue(cur, 'repairAttempts'),
    models: { ...prevModels, ...curModels },
  };
  return out;
}

export const jobService = {
  async markRunning(tx: DbOrTx, jobId: string) {
    await agentJobRepo.transitionStatus(tx, jobId, 'RUNNING', ['QUEUED'], { startedAt: new Date() });
  },

  async resolveGeneration(albumId: string, now: Date = new Date()): Promise<GenerationResolution> {
    const job = await agentJobRepo.findLatestByAlbum(albumId);
    if (!job) return null;
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return null;

    const since = job.startedAt ?? job.createdAt;
    if (now.getTime() - since.getTime() > ZOMBIE_TIMEOUT_MS) {
      const { swept } = await this.sweepStaleJob(job.id, now);
      if (swept) return { kind: 'swept' };
    }
    return { kind: 'progress', stage: job.stage, progress: job.progress };
  },

  async sweepStaleJob(
    jobId: string,
    now: Date,
    timeoutMs: number = ZOMBIE_TIMEOUT_MS,
  ): Promise<{ swept: boolean; releasedHold: boolean }> {
    return db.transaction(async (tx) => {
      const job = await agentJobRepo.findByIdForUpdate(tx, jobId);
      if (!job) return { swept: false, releasedHold: false };
      if (job.status === 'COMPLETED' || job.status === 'FAILED') {
        return { swept: false, releasedHold: false };
      }
      const since = job.startedAt ?? job.createdAt;
      if (now.getTime() - since.getTime() <= timeoutMs) {
        return { swept: false, releasedHold: false };
      }

      await agentJobRepo.update(tx, job.id, {
        status: 'FAILED',
        error: { code: 'AGENT_TIMEOUT', message: `${job.status} > ${timeoutMs}ms without callback` },
        completedAt: now,
      });

      const album = await albumRepo.findById(job.albumId);
      const holdId = album?.creditHoldId ?? null;
      await albumRepo.update(tx, job.albumId, {
        status: 'FAILED',
        errorMessage: 'Generation timed out. No credit was charged.',
      });
      if (holdId) await creditService.release(tx, holdId);

      return { swept: true, releasedHold: !!holdId };
    });
  },

  async handleProgress(requestId: string, stage: string, progress: number) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) return;
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return;
    const currentProgress = Number.isFinite(job.progress) ? job.progress : 0;
    const nextProgress = Math.max(currentProgress, progress);
    const nextStage = progress < currentProgress ? job.stage : stage;
    await agentJobRepo.transitionStatus(db, job.id, 'RUNNING', ['QUEUED', 'RUNNING'], {
      stage: nextStage,
      progress: nextProgress,
      startedAt: new Date(),
    });
  },

  async createGenerationJob(
    tx: DbOrTx,
    input: { userId: string; albumId: string; requestId: string; kind: 'init' },
  ) {
    return agentJobRepo.create(tx, {
      userId: input.userId,
      albumId: input.albumId,
      requestId: input.requestId,
      kind: input.kind,
      status: 'QUEUED',
      progress: 0,
    });
  },

  async handleV3Progress(requestId: string, stage: string, progress: number) {
    await this.handleProgress(requestId, stage, progress);
  },

  async handleV3AnalyzeCompleted(requestId: string, tree: unknown, usage: unknown) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) return;
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return;

    const album = await albumRepo.findById(job.albumId);
    if (!album) {
      logger.warn({ requestId, albumId: job.albumId }, 'album missing on v3 analyze completed');
      return;
    }
    const stage = job.stage ?? '';
    if (SELECT_LAYOUT_COMPLETABLE_STAGES.has(stage) && (job.progress ?? 0) >= 51) {
      return;
    }

    await db.transaction(async (tx) => {
      const won = await agentJobRepo.transitionStatus(tx, job.id, 'RUNNING', ['QUEUED', 'RUNNING'], {
        progress: 50,
        stage: 'layout',
        usage: (usage as Record<string, unknown> | null) ?? null,
        // 时序反转:analyze 完成后 job 停在 RUNNING 等用户「收集故事」,这段不推进进度。清掉
        // startedAt,让 zombie-sweeper(按 startedAt 判 10min 超时)**不把等收集的 job 当死 job**
        // 扫成 FAILED。收集完 submitSelectLayoutV3 会重设 startedAt(排版才真正开始计时)。
        startedAt: null,
      });
      if (!won) return;

      const draftJson = buildAnalyzeDraftJson(tree);

      await albumRepo.update(tx, job.albumId, {
        draftJson,
      });
    });
  },

  // P2 phase 1 (docs/agent/contract.md §5.2.1): the Agent returns candidate
  // STRUCTURES (not pages) for the browser to render into thumbnails. Stash them in
  // the transient store and park the job at the candidates-ready sentinel (progress
  // 52, stage stays 'layout') — does NOT advance album stage, keeps the job/hold
  // open. The browser polls, sees the sentinel, renders thumbnails, and POSTs phase 2.
  // CAS-guarded 51→52 so a duplicate callback can't double-stash or regress progress.
  async handleV3SelectLayoutCandidates(
    requestId: string,
    units: SelectLayoutCandidateUnit[],
    usage: unknown,
  ) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) return;
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return;
    if (!SELECT_LAYOUT_COMPLETABLE_STAGES.has(job.stage ?? '')) return;

    // Atomic CAS 51→52: only the first candidates callback for a select-layout
    // dispatch parks the job and stashes candidates. A late/duplicate callback after
    // phase 2 started (>=53) or completion loses the CAS and is ignored.
    const won = await agentJobRepo.markCandidatesReady(db, job.id, mergeV3Usage(job.usage, usage));
    if (!won) return;
    transientLayoutCandidates.set(requestId, units);
  },

  async handleV3SelectLayoutCompleted(requestId: string, pages: unknown, usage: unknown) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) return;
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return;

    const album = await albumRepo.findById(job.albumId);
    if (!album) {
      logger.warn({ requestId, albumId: job.albumId }, 'album missing on v3 select-layout completed');
      return;
    }
    const parsedDraft = V3StoryDraft.safeParse(album.draftJson);
    if (!SELECT_LAYOUT_COMPLETABLE_STAGES.has(job.stage ?? '') || album.status !== 'AGENT_RUNNING' || !parsedDraft.success) {
      logger.warn(
        {
          requestId,
          albumId: job.albumId,
          jobStage: job.stage,
          albumStatus: album.status,
          hasStoryDraft: parsedDraft.success,
        },
        'ignored select-layout completed callback before analyze tree was ready',
      );
      return;
    }

    await db.transaction(async (tx) => {
      const won = await agentJobRepo.transitionStatus(tx, job.id, 'COMPLETED', ['QUEUED', 'RUNNING'], {
        progress: 100,
        stage: 'wrap',
        usage: mergeV3Usage(job.usage, usage),
        completedAt: new Date(),
      });
      if (!won) return;

      const draftJson = mergeSelectLayoutPages(album.draftJson, pages);

      await albumRepo.update(tx, job.albumId, {
        status: 'EDITING',
        draftJson,
        stage: 'story',
      });

      if (album.creditHoldId) {
        await creditService.settle(tx, job.userId, album.creditHoldId);
      }
    });
  },

  async handleV3Failed(requestId: string, error: { code: string; message: string }) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) return;
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return;

    const mapped = { code: mapAgentErrorCode(error.code), message: error.message };
    await db.transaction(async (tx) => {
      const won = await agentJobRepo.transitionStatus(tx, job.id, 'FAILED', ['QUEUED', 'RUNNING'], {
        error: mapped,
        completedAt: new Date(),
      });
      if (!won) return;
      await albumRepo.update(tx, job.albumId, { status: 'FAILED', errorMessage: error.message });
      await creditService.releaseByAlbum(tx, job.albumId);
    });
  },
};
