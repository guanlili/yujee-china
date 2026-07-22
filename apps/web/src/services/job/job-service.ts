import { db, type DbOrTx } from '@/db/client';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { creditService } from '@/services/credit/credit-service';
import { ERRORS, mapAgentErrorCode } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';
import { Page, V3LayoutTree, V3StoryDraft } from '@yujee/contracts';
import {
  countTreePhotos,
  extractDesignFromPages,
  insertAppendPages,
  mergeAppendTree,
  remapAppendChapterIds,
} from '@/services/album/append-photos';
import {
  DESIGN_COLORS,
  applyComposePagesTexts,
  assembleDesignedPages,
  mergeSlotTexts,
  normalizeDesignFonts,
  sampleTexts,
  sweepCarriers,
  templateCategory,
} from '@/services/album/design-apply';
import { albumMessageRepo } from '@/db/repos/album-message-repo';
import { bakePagesHtml, type BakeablePage } from '@/services/album/bake-html';

// 解耦后 analyze 与 layout 是两个独立 job:init job(analyze,0→100)与 layout job(排版,
// 0→100)各自独立,不再共享一行 agent_jobs 用哨兵进度串联。

const ZOMBIE_TIMEOUT_MS = 5 * 60 * 1000;
// ④ 成稿(compose)是全链路唯一的 AI 调用:按章并发让 Gemini 看真图 + 写全书文案,
// 10 章的书跑过 5 分钟完全正常。engine 侧后台预算是 background_task_timeout_seconds
// (600s),这里必须留在它之上再加回调余量,否则 Web 会在成稿回调回来之前把 job 标成
// FAILED,回调进门第一句就 return,整本书的文案被静默丢弃(重试还撞同一堵墙)。
const COMPOSE_ZOMBIE_TIMEOUT_MS = 12 * 60 * 1000;

// 僵尸超时按 job kind 分档。engine 侧 compose 有逐章心跳,真卡死照样能在 12 分钟被扫掉。
export function zombieTimeoutMsFor(kind: string | null | undefined): number {
  return kind === 'compose' ? COMPOSE_ZOMBIE_TIMEOUT_MS : ZOMBIE_TIMEOUT_MS;
}

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
  // C 方案:落库前逐页烘 HTML(页面真相)。pages 已过 V3Callback 契约校验。
  // HTML 模板已全量注册,strict:漏模板直接失败,不允许无 html 的页落库。
  const baked = Array.isArray(pages) ? bakePagesHtml(pages as BakeablePage[]) : pages;
  return { ...parsed.data, pages: baked };
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
  // C 方案:追加页烘 HTML 落库(carrier 已刷,旧 html 一律作废重烘);老页不动。
  appended = bakePagesHtml(
    appended.map((page) => ({ ...page, html: undefined })),
  ) as typeof appended;
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

// ④ 成稿 job(kind='compose')的派发快照:用户选定的封面组 + 书页底色 + 语言。
// 回调侧据此组页 —— compose 请求发出后 Web 不再需要跟 Agent 对齐任何状态。
export type ComposeJobMeta = {
  language: 'zh' | 'en';
  coverTemplateId: string;
  coverPhotoId: string;
  endingTemplateId: string;
  endingPhotoId: string;
  extraEndingPhotoIds: string[];
  pageBackground?: string;
};

export function readComposeMeta(meta: unknown): ComposeJobMeta | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const raw = (meta as { compose?: unknown }).compose;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const str = (key: string): string =>
    typeof value[key] === 'string' ? (value[key] as string) : '';
  const cover = str('coverTemplateId');
  const ending = str('endingTemplateId');
  if (!cover || !ending) return null;
  const extras = Array.isArray(value.extraEndingPhotoIds)
    ? (value.extraEndingPhotoIds as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  return {
    language: value.language === 'zh' ? 'zh' : 'en',
    coverTemplateId: cover,
    coverPhotoId: str('coverPhotoId'),
    endingTemplateId: ending,
    endingPhotoId: str('endingPhotoId'),
    extraEndingPhotoIds: extras,
    ...(typeof value.pageBackground === 'string' && value.pageBackground
      ? { pageBackground: value.pageBackground }
      : {}),
  };
}

/** compose 回调载荷里 Web 真正消费的四块(其余如 usage 走 job 行)。 */
export type ComposeCompletedPayload = {
  pagesTexts?: Record<string, Record<string, string>>;
  coverTexts?: Record<string, string>;
  endingTexts?: Record<string, string>;
  fonts?: Record<string, string>;
};

/**
 * 成稿落回 draft(纯函数):顺序与旧同步实现(design-apply.assembleDesignedPages)一致 ——
 * 先把 pagesTexts 逐槽合进内页 texts,再组 cover/ending 页、重排 pageIndex、carrier sweep、
 * 整书重烘 html、刷书页底色。
 *
 * 四个数据坑都在这里兜住:
 *  · coverTexts/endingTexts 的空串忽略(mergeSlotTexts),模板 sample 不被洗白;
 *  · pagesTexts 只含真写出来的页,没出现的页 texts 原样保留;
 *  · compose 不回 colors —— 三色用确定性常量 DESIGN_COLORS;
 *  · fonts 可能为空 —— normalizeDesignFonts 按语言兜底。
 */
export function mergeComposeIntoDraft(
  draftJson: unknown,
  meta: ComposeJobMeta,
  payload: ComposeCompletedPayload,
) {
  const parsed = V3StoryDraft.safeParse(draftJson);
  if (!parsed.success || !parsed.data.pages || parsed.data.pages.length === 0) {
    throw ERRORS.VALIDATION_FAILED('compose completion requires an existing paged draft');
  }
  // 幂等重入:已应用过设计则剔除旧封面/封尾,内页原样保留(与旧 applyDesign 同口径)。
  const interiorPages = parsed.data.pages.filter(
    (page) => templateCategory(page.templateId) === 'interior',
  );
  const written = applyComposePagesTexts(interiorPages, payload.pagesTexts);
  const fonts = normalizeDesignFonts(payload.fonts, meta.language);
  const pages = assembleDesignedPages({
    interiorPages: written,
    set: {
      coverTemplateId: meta.coverTemplateId,
      coverPhotoId: meta.coverPhotoId,
      endingTemplateId: meta.endingTemplateId,
      endingPhotoId: meta.endingPhotoId,
    },
    coverTexts: mergeSlotTexts(sampleTexts(meta.coverTemplateId), payload.coverTexts),
    endingTexts: mergeSlotTexts(sampleTexts(meta.endingTemplateId), payload.endingTexts),
    fonts,
    colors: DESIGN_COLORS,
    extraEndingPhotoIds: meta.extraEndingPhotoIds,
    ...(meta.pageBackground ? { pageBackground: meta.pageBackground } : {}),
  });

  // 选定封面 = 故事环节收官:把现存章节全部记 done(与旧同步实现一致)。
  const doneChapterIds = parsed.data.tree.chapters.map((c) => c.chapterId);
  return {
    draftJson: {
      ...parsed.data,
      pages,
      design: {
        fonts,
        colors: DESIGN_COLORS,
        ...(meta.pageBackground ? { pageBackground: meta.pageBackground } : {}),
      },
      progress: { currentChapterId: null, doneChapterIds },
    },
    pages,
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
    if (now.getTime() - since.getTime() > zombieTimeoutMsFor(job.kind)) {
      const { swept } = await this.sweepStaleJob(job.id, now);
      if (swept) return { kind: 'swept' };
    }
    return { kind: 'progress', stage: job.stage, progress: job.progress };
  },

  async sweepStaleJob(
    jobId: string,
    now: Date,
    // 不传 = 按 job kind 取默认档(compose 走 12 分钟,其余 5 分钟)。
    timeoutMs?: number,
  ): Promise<{ swept: boolean; releasedHold: boolean }> {
    return db.transaction(async (tx) => {
      const job = await agentJobRepo.findByIdForUpdate(tx, jobId);
      if (!job) return { swept: false, releasedHold: false };
      if (job.status === 'COMPLETED' || job.status === 'FAILED') {
        return { swept: false, releasedHold: false };
      }
      const effectiveTimeoutMs = timeoutMs ?? zombieTimeoutMsFor(job.kind);
      const since = job.startedAt ?? job.createdAt;
      if (now.getTime() - since.getTime() <= effectiveTimeoutMs) {
        return { swept: false, releasedHold: false };
      }

      await agentJobRepo.update(tx, job.id, {
        status: 'FAILED',
        error: {
          code: 'AGENT_TIMEOUT',
          message: `${job.status} > ${effectiveTimeoutMs}ms without callback`,
        },
        completedAt: now,
      });

      // layout / compose job 卡死:相册留 EDITING(草稿完好),用户重触发即可;不标相册
      // FAILED、不动积分。只有 init(analyze)卡死才把相册标 FAILED + 释放 hold。
      if (job.kind === 'layout' || job.kind === 'compose') {
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
      kind: 'init' | 'layout' | 'add' | 'compose';
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

  // ④ 成稿完成:全书文案一次性回来 → 组页落库 + 推 stage='ready'。
  // 这里是唯一把 stage 推到 'ready' 的地方(导出闸门钥匙)。
  async handleV3ComposeCompleted(
    requestId: string,
    payload: ComposeCompletedPayload,
    usage: unknown,
  ) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) return;
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return;

    const album = await albumRepo.findById(job.albumId);
    if (!album) {
      logger.warn({ requestId, albumId: job.albumId }, 'album missing on v3 compose completed');
      return;
    }
    const meta = readComposeMeta(job.meta);
    if (!meta) {
      logger.warn({ requestId, albumId: job.albumId }, 'compose job has no cover-set meta');
      await this.handleV3Failed(requestId, {
        code: 'AGENT_INVALID_OUTPUT',
        message: 'compose job lost its cover-set meta',
      });
      return;
    }

    let merged: ReturnType<typeof mergeComposeIntoDraft>;
    try {
      merged = mergeComposeIntoDraft(album.draftJson, meta, payload);
    } catch (e) {
      logger.error(
        { err: String(e), requestId, albumId: job.albumId },
        'compose completed but draft assembly failed',
      );
      await this.handleV3Failed(requestId, {
        code: 'AGENT_INVALID_OUTPUT',
        message: 'compose result could not be applied to the draft',
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

      await albumRepo.update(tx, job.albumId, {
        draftJson: merged.draftJson,
        pageCount: merged.pages.length,
        // 设计完成 → 待导出(导出闸门的唯一开门钥匙);幂等重设计时已是 ready 则维持不动。
        ...(album.stage !== 'ready' ? { stage: 'ready' as const } : {}),
      });

      // 成稿回执进会话历史(用户消息在派发时已落库,这里补 assistant 回复,只在真成稿后写)。
      await albumMessageRepo.create(tx, {
        albumId: job.albumId,
        userId: job.userId,
        role: 'assistant',
        content:
          meta.language === 'zh'
            ? '写好了:封面封底就位,全书文案、字体和配色也一起刷上了。不满意随时在对话里改。'
            : 'All set — cover & back cover are in, and the whole book now has its copy, fonts and colors. Ask me here to tweak anything.',
      });
      // 积分已在 analyze 完成时结算,compose job 不挂 hold。
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
      // layout / compose job 失败:相册已是 EDITING(草稿完好),保持可编辑,用户可重触发。
      // 不标相册 FAILED、不动积分(积分在 analyze 时已结算,这两类 job 不挂 hold)。
      // 只有 init 失败才失败相册。
      if (job.kind === 'layout' || job.kind === 'compose') return;
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
