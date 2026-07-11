import { db, type DbOrTx } from '@/db/client';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { creditService } from '@/services/credit/credit-service';
import { ERRORS, mapAgentErrorCode } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';
import { transientLayoutCandidates } from '@/services/album/layout-candidates';
import { Page, V3LayoutTree, V3StoryDraft, type SelectLayoutCandidateUnit } from '@yujee/contracts';
import {
  countTreePhotos,
  extractDesignFromPages,
  insertAppendPages,
  mergeAppendTree,
  remapAppendChapterIds,
} from '@/services/album/append-photos';
import { sweepCarriers } from '@/services/album/design-apply';

// 解耦后 analyze 与 layout 是两个独立 job:init job(analyze,0→100)与 layout job(排版,
// 0→100)各自独立,不再共享一行 agent_jobs 用 50/51/52 哨兵串联。两段式候选流(如重启用)
// 仍用 candidates-ready 进度标记。
export const SELECT_LAYOUT_CANDIDATES_READY_PROGRESS = 52;

const ZOMBIE_TIMEOUT_MS = 5 * 60 * 1000;

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

// 追加排版完成(加图增量重跑 spec §1):新页插到封尾前 + 继承全书设计 carrier + 新章
// 直接记 done(追加不走逐章确认循环,导出闸门靠 allDone 自动恢复)。老页/老章一律不动。
export function mergeAppendLayoutPages(
  draftJson: unknown,
  pages: unknown,
  appendChapterIds: string[],
) {
  const parsed = V3StoryDraft.safeParse(draftJson);
  if (!parsed.success || !parsed.data.pages || parsed.data.pages.length === 0) {
    throw ERRORS.VALIDATION_FAILED('append layout completion requires an existing paged draft');
  }
  const existingPages = parsed.data.pages;
  let appended = Page.array().parse(pages);
  const design = extractDesignFromPages(existingPages);
  if (design) appended = sweepCarriers(appended, design.fonts, design.colors);
  const mergedPages = insertAppendPages(existingPages, appended);

  const chapterOrder = parsed.data.tree.chapters.map((c) => c.chapterId);
  const doneSet = new Set(parsed.data.progress.doneChapterIds);
  for (const id of appendChapterIds) if (chapterOrder.includes(id)) doneSet.add(id);
  const nextCurrent = chapterOrder.find((id) => !doneSet.has(id)) ?? null;

  return {
    ...parsed.data,
    pages: mergedPages,
    progress: {
      currentChapterId: nextCurrent,
      doneChapterIds: chapterOrder.filter((id) => doneSet.has(id)),
    },
  };
}

// layout job 的追加范围标记(agent_jobs.meta.appendChapterIds);非追加/坏形状 → null。
export function readAppendChapterIds(meta: unknown): string[] | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const ids = (meta as { appendChapterIds?: unknown }).appendChapterIds;
  return Array.isArray(ids) && ids.length > 0 && ids.every((x) => typeof x === 'string')
    ? (ids as string[])
    : null;
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

      // layout job 卡死:相册留 EDITING(草稿完好),用户重触发排版即可;不标相册 FAILED、不动
      // 积分。只有 init(analyze)卡死才把相册标 FAILED + 释放 hold。
      if (job.kind === 'layout') {
        return { swept: true, releasedHold: false };
      }
      // 追加卡死:老书完好,释放追加 hold(不扣钱),相册保持 EDITING 可重试。
      if (job.kind === 'add') {
        const appendAlbum = await albumRepo.findById(job.albumId);
        const appendHoldId = appendAlbum?.creditHoldId ?? null;
        if (appendHoldId) await creditService.release(tx, appendHoldId);
        return { swept: true, releasedHold: !!appendHoldId };
      }

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
    input: {
      userId: string;
      albumId: string;
      requestId: string;
      kind: 'init' | 'layout' | 'add';
      // layout job 的追加范围标记({ appendChapterIds }),见 schema.agentJobs.meta。
      meta?: Record<string, unknown>;
    },
  ) {
    return agentJobRepo.create(tx, {
      userId: input.userId,
      albumId: input.albumId,
      requestId: input.requestId,
      kind: input.kind,
      status: 'QUEUED',
      progress: 0,
      ...(input.meta ? { meta: input.meta } : {}),
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

    // 追加照片(kind='add'):新章节树「合并」进既有 draft,不覆盖、不动 status/stage。
    // 新 chapterId 重映射防撞号;photoCount 累加;积分照搬首次口径 analyze 完成即 settle
    // (hold 在 submitAddPhotosV3 挂到 album.creditHoldId)。
    if (job.kind === 'add') {
      const parsedDraft = V3StoryDraft.safeParse(album.draftJson);
      const parsedTree = V3LayoutTree.safeParse(tree);
      if (!parsedDraft.success || !parsedTree.success) {
        logger.warn(
          { requestId, albumId: job.albumId },
          'append analyze completed but draft/tree failed to parse',
        );
        await this.handleV3Failed(requestId, {
          code: 'AGENT_INVALID_OUTPUT',
          message: 'append tree merge failed',
        });
        return;
      }
      await db.transaction(async (tx) => {
        const won = await agentJobRepo.transitionStatus(tx, job.id, 'COMPLETED', ['QUEUED', 'RUNNING'], {
          progress: 100,
          stage: 'wrap',
          usage: (usage as Record<string, unknown> | null) ?? null,
          completedAt: new Date(),
        });
        if (!won) return;

        const existingIds = new Set(parsedDraft.data.tree.chapters.map((c) => c.chapterId));
        const remapped = remapAppendChapterIds(
          parsedTree.data.chapters,
          existingIds,
          `add${job.requestId.replace(/-/g, '').slice(0, 8)}`,
        );
        const draftJson = mergeAppendTree(parsedDraft.data, remapped);

        await albumRepo.update(tx, job.albumId, {
          draftJson,
          photoCount: album.photoCount + countTreePhotos(remapped),
        });
        if (album.creditHoldId) {
          await creditService.settle(tx, job.userId, album.creditHoldId);
        }
      });
      return;
    }

    await db.transaction(async (tx) => {
      // 解耦:analyze 是 init job 的交付物,完成即 COMPLETED —— 不再停在 layout「等收集」。
      // 相册直接进 EDITING/story(收集态),用户由此进采访编辑器(page.tsx: EDITING &
      // layoutJson==null → authoring)。排版由用户采访完另起独立 layout job 触发。于是采访
      // 期间没有任何 RUNNING job,相册隔多久回来都不会被僵尸检查误杀。
      const won = await agentJobRepo.transitionStatus(tx, job.id, 'COMPLETED', ['QUEUED', 'RUNNING'], {
        progress: 100,
        stage: 'wrap',
        usage: (usage as Record<string, unknown> | null) ?? null,
        completedAt: new Date(),
      });
      if (!won) return;

      const draftJson = buildAnalyzeDraftJson(tree);

      await albumRepo.update(tx, job.albumId, {
        status: 'EDITING',
        stage: 'story',
        draftJson,
      });

      // 扣费时机(用户拍板):选完照片建相册即扣。analyze 完成 = 相册真正成形,
      // 在此结算 hold(HOLDING→SETTLED)。后续「收集故事→排版」不再动积分。
      if (album.creditHoldId) {
        await creditService.settle(tx, job.userId, album.creditHoldId);
      }
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
    // 解耦后 job 是独立 layout job(不再是共享 init job 的 50/51/52 哨兵)。两段式候选流本地
    // 未启用(inline judge),此处仅在被调用时暂存候选、不崩;两段式重启用需另行适配。
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
    // 解耦:这是独立 layout job 的完成回调。只需草稿已就绪(analyze 已写树)即可合并排版页;
    // 相册在 analyze 完成时就已 EDITING/story,这里不再改 status/stage,只补 pages。
    if (!parsedDraft.success) {
      logger.warn(
        { requestId, albumId: job.albumId, albumStatus: album.status },
        'select-layout completed but album has no v3-story draft',
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

      // 追加排版(job.meta.appendChapterIds)走插入合并;普通全书排版整表替换 pages。
      const appendChapterIds = readAppendChapterIds(job.meta);
      const draftJson = appendChapterIds
        ? mergeAppendLayoutPages(album.draftJson, pages, appendChapterIds)
        : mergeSelectLayoutPages(album.draftJson, pages);

      await albumRepo.update(tx, job.albumId, { draftJson });

      // 积分已在 analyze 完成时结算,这里不动积分(layout job 不挂 hold)。
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
      // layout job 失败:相册已是 EDITING(草稿完好),保持可编辑,用户可重触发排版。不标相册
      // FAILED、不动积分(积分在 analyze 时已结算,layout job 不挂 hold)。只有 init 失败才失败相册。
      if (job.kind === 'layout') return;
      // 追加失败:老书完好,只释放追加 hold,不标 FAILED;用户重新点「+」再来一次。
      if (job.kind === 'add') {
        await creditService.releaseByAlbum(tx, job.albumId);
        return;
      }
      await albumRepo.update(tx, job.albumId, { status: 'FAILED', errorMessage: error.message });
      await creditService.releaseByAlbum(tx, job.albumId);
    });
  },
};
