import { db, type DbOrTx } from '@/db/client';
import { agentJobRepo } from '@/db/repos/agent-job-repo';
import { albumRepo } from '@/db/repos/album-repo';
import { draftPageRepo } from '@/db/repos/draft-page-repo';
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
// draft_pages 拆表(Phase 1a):三个回调写点(analyze-append/select-layout/compose)
// 加 album 行锁 + 切行级写(docs/plans/2026-08-03-draft-pages-split.md Task 5)。
import {
  bumpDraftRevision,
  ensureDraftPagesSeeded,
  envelopeJson,
  loadStoryDraft,
  parseDraftEnvelope,
} from '@/services/album/draft-store';

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
      // pageBackground 现在是契约字段(V3StoryDraft.design.pageBackground,Phase 1a
      // Task 6):直接写,不用再靠 spread 绕开 zod 严格 schema 丢字段的问题
      // (行为等价 —— meta.pageBackground 缺省时这里就是 undefined,JSON 落库时
      // 与此前「整个键都不出现」的效果相同)。
      design: {
        fonts,
        colors: DESIGN_COLORS,
        pageBackground: meta.pageBackground,
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
    // 锁序反转修复(Task 5 follow-up,2026-08-03):三个 job 回调写事务
    // (handleV3AnalyzeCompleted/handleV3SelectLayoutCompleted/
    // handleV3ComposeCompleted)现在固定先锁 albums 行、后碰 agent_jobs 行
    // (计划 Global Constraints 强制的写事务次序:album 行锁必须打头)。这个函数
    // 原来是反过来:先锁 job 行(agentJobRepo.findByIdForUpdate),只有
    // kind==='init'(下面的兜底分支)的僵尸才会再去 UPDATE albums 行——那条分支
    // 因此与三个回调构成经典 AB-BA 锁序,是真实的 Postgres 死锁对(同一个 init
    // job 恰好在僵尸扫描与真实回调同时触发的窄窗口内可复现)。
    //
    // 标准修法:先做一次**不加锁**的 job 读,只用来看 albumId/kind——这两个字段
    // 在 job 行创建后从不被任何写点改动(不是"可能过期但够用",是真正不可变),
    // 所以可以放心据此决定"这次 sweep 是否会碰 albums 行、需不需要先把它锁上",
    // 不必重新验证。真正会变的字段(status/startedAt 等)一律不看这次 peek,
    // 全部留到进事务、拿到锁之后重读判定——peek 只管锁的顺序,不管业务判定。
    // layout/compose/add 三个分支在这个函数里从不 UPDATE albums 行(add 分支的
    // albumRepo.findById 是无锁 plain SELECT,只为读 creditHoldId,不产生行锁),
    // 维持原来的「只锁 job 行」路径,不存在锁序冲突,不必多绕一次 album 锁。
    const peek = await agentJobRepo.findById(jobId);
    if (!peek) return { swept: false, releasedHold: false };
    const touchesAlbumRow = peek.kind !== 'layout' && peek.kind !== 'compose' && peek.kind !== 'add';

    return db.transaction(async (tx) => {
      // ALBUM 锁必须先拿(需要的话),再拿 JOB 锁——与三个回调的锁序对齐。拿到的
      // 这份 album 快照就是锁内最新状态,下面兜底分支直接复用,不再多读一次。
      const lockedAlbum = touchesAlbumRow
        ? await albumRepo.findByIdForUpdate(tx, peek.albumId)
        : undefined;

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

      // job.kind 是不可变字段,这里必然与 peek.kind 一致,touchesAlbumRow 必然为
      // true,lockedAlbum 就是锁内读到的最新 albums 行——不再重读一次。
      const holdId = lockedAlbum?.creditHoldId ?? null;
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

    // 追加照片(kind='add'):新章节树「合并」进既有 draft,不覆盖、不动 status/stage。
    // 新 chapterId 重映射防撞号;photoCount 累加;积分照搬首次口径 analyze 完成即 settle
    // (hold 在 submitAddPhotosV3 挂到 album.creditHoldId)。
    //
    // draft_pages 拆表(Phase 1a)固定写事务次序:album 行锁(findByIdForUpdate)必须
    // 打头 —— 这条分支此前在事务外无锁读 album,再用那份陈旧快照在事务内算 draftJson/
    // photoCount 落库,是收口的「无锁读改写窗口」之一。校验(既有 envelope 能否解析 +
    // 新树能否解析)现在也挪进锁内,用锁内的新鲜快照判断;仍然只在校验通过后才尝试
    // job CAS,校验失败照旧走事务外的 handleV3Failed(与今天一致,不在事务里嵌套第二
    // 个 CAS)。这一分支只改 tree/progress、不编辑 pages,但**仍然必须**
    // ensureDraftPagesSeeded(2026-08-03 controller follow-up 修的真实 bug):
    // add-photos 的前置闸门(generation-service.submitAddPhotosV3)要求相册已有
    // 排版页,但那些页可能还没被任何行级写点摸过、仍然只活在 legacy
    // draftJson.pages 里(拆表刚上线、或老书从没被 updatePage/reorderPages/
    // select-layout/compose 碰过)。若不先播种就直接拿 envelope-only 覆盖
    // draftJson,会把这唯一一份 pages 连根拔掉——整本书的页静默消失。播种是
    // no-op-or-migrate:已有行 → 什么也不做;只有 legacy pages 才复制进
    // draft_pages 行,不推进 revision(除了「从 0 首次立到 1」这个懒播种自身
    // 的既定副作用,与 Task 3/4 同口径)。
    if (job.kind === 'add') {
      const parsedTree = V3LayoutTree.safeParse(tree);
      let invalidReason: string | null = null;

      await db.transaction(async (tx) => {
        const album = await albumRepo.findByIdForUpdate(tx, job.albumId);
        if (!album) {
          logger.warn({ requestId, albumId: job.albumId }, 'album missing on v3 analyze completed');
          return;
        }
        const envelope = parseDraftEnvelope(album.draftJson);
        if (!envelope || !parsedTree.success) {
          invalidReason = 'append tree merge failed';
          return;
        }

        const won = await agentJobRepo.transitionStatus(tx, job.id, 'COMPLETED', ['QUEUED', 'RUNNING'], {
          progress: 100,
          stage: 'wrap',
          usage: (usage as Record<string, unknown> | null) ?? null,
          completedAt: new Date(),
        });
        if (!won) return;

        const existingIds = new Set(envelope.tree.chapters.map((c) => c.chapterId));
        const remapped = remapAppendChapterIds(
          parsedTree.data.chapters,
          existingIds,
          `add${job.requestId.replace(/-/g, '').slice(0, 8)}`,
        );
        const merged = mergeAppendTree(
          { version: 'v3-story', tree: envelope.tree, progress: envelope.progress },
          remapped,
        );

        // 播种必须先于下面的 envelope-only 覆盖(见上方注释);返回值本身不需要
        // ——这条分支不推进 revision,只是确保任何 legacy pages 在被覆盖前已经
        // 安全落到 draft_pages 行。
        await ensureDraftPagesSeeded(tx, album);

        await albumRepo.update(tx, job.albumId, {
          draftJson: envelopeJson({
            tree: merged.tree,
            progress: merged.progress,
            design: envelope.design,
          }),
          photoCount: album.photoCount + countTreePhotos(remapped),
        });
        if (album.creditHoldId) {
          await creditService.settle(tx, job.userId, album.creditHoldId);
        }
      });

      if (invalidReason) {
        logger.warn(
          { requestId, albumId: job.albumId },
          'append analyze completed but draft/tree failed to parse',
        );
        await this.handleV3Failed(requestId, {
          code: 'AGENT_INVALID_OUTPUT',
          message: invalidReason,
        });
      }
      return;
    }

    await db.transaction(async (tx) => {
      const album = await albumRepo.findByIdForUpdate(tx, job.albumId);
      if (!album) {
        logger.warn({ requestId, albumId: job.albumId }, 'album missing on v3 analyze completed');
        return;
      }

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

      // 这是这本相册第一份 draft(analyze 首次完成),从不带 pages —— buildAnalyzeDraftJson
      // 已经是 envelope 形状,不需要经 envelopeJson 二次包装,也没有 draft_pages 行可播种/
      // 推进(还没有页,revision 不动)。
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

    // draft_pages 拆表(Phase 1a)固定写事务次序:album 行锁在前(收口第二个无锁读改写
    // 窗口 —— 这条分支此前在事务外无锁读 album,再据此在事务内整表替换 draftJson.pages)。
    // 草稿是否就绪的校验现在也用锁内快照做;校验失败仍是「静默留 job RUNNING」——与今天
    // 完全一致的语义,不新增 handleV3Failed 调用,也不尝试 job CAS。
    await db.transaction(async (tx) => {
      const album = await albumRepo.findByIdForUpdate(tx, job.albumId);
      if (!album) {
        logger.warn({ requestId, albumId: job.albumId }, 'album missing on v3 select-layout completed');
        return;
      }

      // 解耦:这是独立 layout job 的完成回调。只需草稿已就绪(analyze 已写树)即可合并
      // 排版页;相册在 analyze 完成时就已 EDITING/story,这里不再改 status/stage,只补页。
      const loaded = await loadStoryDraft(album, { tx, bake: false });
      if (!loaded) {
        logger.warn(
          { requestId, albumId: job.albumId, albumStatus: album.status },
          'select-layout completed but album has no v3-story draft',
        );
        return;
      }

      const won = await agentJobRepo.transitionStatus(tx, job.id, 'COMPLETED', ['QUEUED', 'RUNNING'], {
        progress: 100,
        stage: 'wrap',
        usage: mergeV3Usage(job.usage, usage),
        completedAt: new Date(),
      });
      if (!won) return;

      // 页源从 album.draftJson.pages 切到 loadStoryDraft 的行读(行存在读行、全书无行才
      // 回退 legacy draftJson.pages,已在锁内解出)。mergeSelectLayoutPages /
      // mergeAppendLayoutPages 内部逻辑(含各自的 bake 语义)原样不动,只换它们吃进去的
      // 「draftJson 形状」页源。
      const draftJsonLike = {
        version: 'v3-story' as const,
        tree: loaded.tree,
        progress: loaded.progress,
        pages: loaded.pages,
        ...(loaded.design ? { design: loaded.design } : {}),
      };

      // 追加排版(job.meta.appendChapterIds)走插入合并;普通全书排版整表替换 pages。
      const appendChapterIds = readAppendChapterIds(job.meta);
      const merged = appendChapterIds
        ? mergeAppendLayoutPages(draftJsonLike, pages, appendChapterIds)
        : mergeSelectLayoutPages(draftJsonLike, pages);
      const mergedPages = merged.pages as Page[];

      const seededRevision = await ensureDraftPagesSeeded(tx, album);
      const rev = await bumpDraftRevision(tx, job.albumId, seededRevision);
      // 系统/agent 写点:updatedBy = null(与 T3/T4 用户写点传 userId 的口径一致)。
      await draftPageRepo.replaceAll(tx, job.albumId, mergedPages, rev, null);

      // envelope 只剩 tree/progress/design;pageCount 收口点二 —— 拆表前 pages 与
      // pageCount 天然同源,拆表后必须显式跟上(此前这里遗漏了 pageCount)。
      await albumRepo.update(tx, job.albumId, {
        draftJson: envelopeJson({ tree: merged.tree, progress: merged.progress, design: merged.design }),
        pageCount: mergedPages.length,
      });

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

    // draft_pages 拆表(Phase 1a)固定写事务次序:album 行锁在前(收口第三个无锁读改写
    // 窗口 —— 这条分支此前在事务外无锁读 album、在事务外算好 mergeComposeIntoDraft 的
    // 结果,再在事务内原样写入,中间那段计算完全没锁)。meta 缺失/合并失败仍在事务内
    // 判定,失败原因带出事务后再调 handleV3Failed(与今天一致,不在事务里嵌套第二个
    // CAS)。
    let failure: { code: string; message: string } | null = null;

    await db.transaction(async (tx) => {
      const album = await albumRepo.findByIdForUpdate(tx, job.albumId);
      if (!album) {
        logger.warn({ requestId, albumId: job.albumId }, 'album missing on v3 compose completed');
        return;
      }
      const meta = readComposeMeta(job.meta);
      if (!meta) {
        logger.warn({ requestId, albumId: job.albumId }, 'compose job has no cover-set meta');
        failure = { code: 'AGENT_INVALID_OUTPUT', message: 'compose job lost its cover-set meta' };
        return;
      }

      // 页源同 select-layout:从 loadStoryDraft 的行读取 existing pages(bake:false ——
      // assembleDesignedPages 反正会把全书重烘一遍,这里不用重复现场烘),拼一个
      // draftJson 形状喂给 mergeComposeIntoDraft(该函数内部组页逻辑原样不动;
      // design.pageBackground 已在 Task 6 进契约,mergeComposeIntoDraft 内部改
      // 为直写契约字段,不再靠 spread 绕开 zod strip)。
      const loaded = await loadStoryDraft(album, { tx, bake: false });
      const draftJsonLike = loaded
        ? {
            version: 'v3-story' as const,
            tree: loaded.tree,
            progress: loaded.progress,
            pages: loaded.pages,
            ...(loaded.design ? { design: loaded.design } : {}),
          }
        : null;

      let merged: ReturnType<typeof mergeComposeIntoDraft>;
      try {
        merged = mergeComposeIntoDraft(draftJsonLike, meta, payload);
      } catch (e) {
        logger.error(
          { err: String(e), requestId, albumId: job.albumId },
          'compose completed but draft assembly failed',
        );
        failure = {
          code: 'AGENT_INVALID_OUTPUT',
          message: 'compose result could not be applied to the draft',
        };
        return;
      }

      const won = await agentJobRepo.transitionStatus(tx, job.id, 'COMPLETED', ['QUEUED', 'RUNNING'], {
        progress: 100,
        stage: 'wrap',
        usage: (usage as Record<string, unknown> | null) ?? null,
        completedAt: new Date(),
      });
      if (!won) return;

      const seededRevision = await ensureDraftPagesSeeded(tx, album);
      const rev = await bumpDraftRevision(tx, job.albumId, seededRevision);
      // 系统/agent 写点:updatedBy = null(与 T3/T4 用户写点传 userId 的口径一致)。
      await draftPageRepo.replaceAll(tx, job.albumId, merged.pages, rev, null);

      await albumRepo.update(tx, job.albumId, {
        draftJson: envelopeJson({
          tree: merged.draftJson.tree,
          progress: merged.draftJson.progress,
          design: merged.draftJson.design,
        }),
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

    if (failure) {
      await this.handleV3Failed(requestId, failure);
    }
  },

  async handleV3Failed(requestId: string, error: { code: string; message: string }) {
    const job = await agentJobRepo.findByRequestId(requestId);
    if (!job) return;
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return;

    const mapped = { code: mapAgentErrorCode(error.code), message: error.message };
    // 锁序修复(controller 二次派单,2026-08-03,与 sweepStaleJob 同一类问题):下面的
    // 兜底(init/finalize)分支原来是先锁 job 行(agentJobRepo.transitionStatus)、再锁
    // album 行(albumRepo.update)——与三个回调 + 已修的 sweepStaleJob 的 album→job 顺序
    // 相反,构成同一类 AB-BA 死锁对。这条路径从 /api/v3/internal/job-progress 的
    // event:'failed' 活着可达,最可能撞上的窗口是:同一个 init job 快到僵尸超时,一条
    // 迟到的 'failed' 回调与 sweepStaleJob 前后脚触发。
    // job.kind/job.albumId 不可变(与 sweepStaleJob 的 peek 同一论证——job 行创建后这两个
    // 字段从不被任何写点改动),可以直接用最上面已经读到的 job 对象判断这次要不要先锁
    // album,不需要像 sweepStaleJob 那样再多读一次。
    const touchesAlbumRow = job.kind !== 'layout' && job.kind !== 'compose' && job.kind !== 'add';
    await db.transaction(async (tx) => {
      // ALBUM 锁必须先拿(需要的话),再拿 JOB 锁——与三个回调、sweepStaleJob 的锁序对齐。
      if (touchesAlbumRow) {
        await albumRepo.findByIdForUpdate(tx, job.albumId);
      }
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
