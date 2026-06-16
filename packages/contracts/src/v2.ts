// Agent v2 contracts — authoring 树 + /v2/album/* 端点 + v2 callback。
//
// 真相源(TS),Python `apps/agent/src/schemas.py` 镜像(extra='forbid')。
// 设计基线:docs/agent/rebuild-architecture.md + docs/agent/rebuild-tech-plan.md。
//
// 硬约定(修复评审 P0-2):本文所有对象一律 `.strict()`(含嵌套),拒未知字段。
//   zod3 的 `.strict()` 只作用于当前层,故每层 object 都显式 `.strict()`。
//   尤其 init 的 `exif` 必须 strict —— 这是 D-GPS 隐私边界的执行点(拒收 lat/lng)。
//
// 不改 `layout.ts`:对外扁平 `AlbumLayoutPlan` 保持 5 字段;v2 扩充字段只活在
//   `V2PhotoAnalysis`,finalize 时 strip。
import { z } from 'zod';
import { Page, PhotoAnalysis, AlbumLayoutPlan } from './layout';

// ────────────────────────────── 共享枚举 ──────────────────────────────

export const V2Language = z.enum(['zh', 'en']);
export type V2Language = z.infer<typeof V2Language>;

export const V2Style = z.enum([
  'warm-film',
  'editorial-mono',
  'soft-pastel',
  'bold-contrast',
  'vintage-print',
]);
export type V2Style = z.infer<typeof V2Style>;

/** 两类异步 job;失败/收尸语义相反(architecture §5)。 */
// 'add' = mid-edit add-photos (W11): append new pages to a finalized album.
export const V2JobKind = z.enum(['init', 'finalize', 'add']);
export type V2JobKind = z.infer<typeof V2JobKind>;

/**
 * init 子阶段 + finalize 单阶段(进度语义,contract.md §5 沿用)。
 * 'writing'(#161):init 在 skeleton 之后、finalize 之前直接批量写第一版全部文案
 * (封面 + 各章正文,去掉逐章对话写作),故插在 skeleton 与 finalize 之间。
 */
export const V2JobStage = z.enum(['vision', 'grouping', 'skeleton', 'writing', 'finalize']);
export type V2JobStage = z.infer<typeof V2JobStage>;

/** 逐章对话状态机(requirements §5)。 */
export const V2ChapterState = z.enum([
  'empty',
  'asking',
  'brief_ready',
  'generated',
  'skipped',
  'finalized',
]);
export type V2ChapterState = z.infer<typeof V2ChapterState>;

export const V2ChapterRole = z.enum(['opening', 'body', 'closing']);
export type V2ChapterRole = z.infer<typeof V2ChapterRole>;

// ────────────────────────────── Usage ──────────────────────────────

/** v2 统一 usage,init/theme/chapter-chat/finalize/edit 共用。 */
export const Usage = z
  .object({
    durationMs: z.number().int().nonnegative(),
    visionCallCount: z.number().int().nonnegative().default(0),
    planningInputTokens: z.number().int().nonnegative().default(0),
    planningOutputTokens: z.number().int().nonnegative().default(0),
    repairAttempts: z.number().int().nonnegative().default(0),
    models: z
      .object({ vision: z.string().optional(), planning: z.string().optional() })
      .strict(),
  })
  .strict();
export type Usage = z.infer<typeof Usage>;

// ────────────────────────────── theme / brief ──────────────────────────────

export const V2Theme = z
  .object({
    subject: z.string(),
    occasion: z.string().optional(),
    timeframe: z.string().optional(),
    tone: z.string(),
    style: V2Style,
  })
  .strict();
export type V2Theme = z.infer<typeof V2Theme>;

/** 逐章 intake 蒸馏(requirements §3）。 */
export const V2Brief = z
  .object({
    userWords: z.string().optional(),
    factNote: z.string().optional(),
    mood: z.string().optional(),
  })
  .strict();
export type V2Brief = z.infer<typeof V2Brief>;

// ────────────────────────────── authoring 树 ──────────────────────────────

/**
 * authoring 期【内部】照片分析。扩充字段(peopleCount/scene/mood/timeOfDay)
 * 仅用于分组/排版/配文,finalize 时 strip,绝不进入对外 AlbumLayoutPlan.photos。
 */
export const V2PhotoAnalysis = z
  .object({
    // —— 基础 5 字段:与 layout.ts PhotoAnalysis 同形,finalize 直接保留 ——
    photoId: z.string().min(1),
    description: z.string(),
    tags: z.array(z.string()),
    quality: z.enum(['hero', 'detail', 'fill']),
    orientation: z.enum(['portrait', 'landscape', 'square']),
    // —— 扩充字段:内部辅助,finalize strip ——
    peopleCount: z.enum(['0', '1', '2-3', '4+']),
    scene: z.enum(['indoor', 'outdoor', 'nature', 'city', 'interior']),
    mood: z.enum(['warm', 'cool', 'sentimental', 'energetic', 'quiet']),
    timeOfDay: z.enum(['morning', 'day', 'evening', 'night']).nullable().optional(),
  })
  .strict();
export type V2PhotoAnalysis = z.infer<typeof V2PhotoAnalysis>;

export const V2Photo = z
  .object({
    photoId: z.string().min(1),
    analysis: V2PhotoAnalysis,
    exif: z
      .object({
        takenAt: z.string().datetime().nullable().optional(), // 低敏,入库
        place: z.string().nullable().optional(), // v1 恒 null(D-GPS);保留供 v2 复用
        order: z.number().int().nonnegative(), // 上传序,EXIF 缺失时排序兜底
      })
      .strict(),
    duplicateOf: z.string().nullable().optional(), // 指向代表图 photoId
    used: z.boolean(), // 重复簇非代表图 = false,折叠不删
  })
  .strict();
export type V2Photo = z.infer<typeof V2Photo>;

export const V2Cluster = z
  .object({
    label: z.string(),
    timeRange: z.string().nullable().optional(),
    place: z.string().nullable().optional(),
    role: V2ChapterRole,
  })
  .strict();
export type V2Cluster = z.infer<typeof V2Cluster>;

export const V2Chapter = z
  .object({
    chapterId: z.string().min(1),
    state: V2ChapterState,
    cluster: V2Cluster,
    photoIds: z.array(z.string()), // 同组永远在一起;指向 used=true 的 photo
    brief: V2Brief.optional(),
    askCount: z.number().int().nonnegative().default(0), // ≥2 自动前进(§5)
    pages: z.array(Page), // Stage3 填 templateId+images;Stage4 填 texts
  })
  .strict();
export type V2Chapter = z.infer<typeof V2Chapter>;

/** 整棵 authoring 树,存 albums.draft_json,只活在交互期。 */
export const AlbumDraft = z
  .object({
    version: z.literal('v2'),
    meta: z
      .object({
        theme: V2Theme.partial().optional(), // Stage2 前可能只有 promptHint
        style: V2Style.default('warm-film'),
        language: V2Language,
        promptHint: z.string().max(500).optional(),
      })
      .strict(),
    photoPool: z.array(V2Photo),
    basePages: z
      .object({
        cover: Page, // 必有;init 给默认 cover
        toc: Page.nullable().optional(), // 章≥4 且 总页≥8 才有(§4.4)
        ending: Page, // closing page; falls back to an active interior template when no ending template exists
      })
      .strict(),
    chapters: z.array(V2Chapter),
  })
  .strict();
export type AlbumDraft = z.infer<typeof AlbumDraft>;

// ────────────────────────────── 端点 req/res ──────────────────────────────

const V2ChatTurn = z
  .object({ role: z.enum(['user', 'assistant']), content: z.string() })
  .strict();

/** 接单成功响应(init / finalize 共用),同 contract.md §2.1。 */
export const V2AcceptedResponse = z
  .object({
    ok: z.literal(true),
    data: z
      .object({ requestId: z.string().min(1), accepted: z.literal(true) })
      .strict(),
  })
  .strict();
export type V2AcceptedResponse = z.infer<typeof V2AcceptedResponse>;

// ── POST /v2/album/init(异步 202 + callback;唯一带 base64)──
const V2InitPhoto = z
  .object({
    photoId: z.string().min(1),
    base64: z.string().min(1), // data:image/(jpeg|png);base64,…  ≤800KB
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    exif: z
      .object({ takenAt: z.string().datetime().nullable().optional() })
      .strict() // ★ 拒 lat/lng — D-GPS 隐私执行点(P0-2)
      .optional(),
  })
  .strict();

export const V2InitRequest = z
  .object({
    requestId: z.string().min(1),
    albumId: z.string().min(1),
    callbackUrl: z.string().url(),
    language: V2Language,
    meta: z.object({ promptHint: z.string().max(500).optional() }).strict().optional(),
    photos: z.array(V2InitPhoto).min(1).max(30),
  })
  .strict();
export type V2InitRequest = z.infer<typeof V2InitRequest>;

// ── POST /v2/album/theme(同步)──
export const V2ThemeRequest = z
  .object({
    albumId: z.string().min(1),
    language: V2Language,
    clustersOverview: z
      .array(
        z
          .object({
            chapterId: z.string(),
            label: z.string(),
            place: z.string().nullable().optional(),
            timeRange: z.string().nullable().optional(),
            photoDescs: z.array(z.string()).max(8),
          })
          .strict(),
      )
      .min(1),
    currentTheme: V2Theme.optional(),
    userMessage: z.string().max(500).optional(),
  })
  .strict();
export type V2ThemeRequest = z.infer<typeof V2ThemeRequest>;

/**
 * 主题候选(editor.html「确定主题」阶段:themeAsk + themeOpt1-3 让用户挑)。
 * 至少含 `subject`(选项主标题)+ 简短 `label`(给用户看的一行字,如 海边漫步);
 * 可附 tone/style 暗示该选项的基调与版式。纯展示用,浏览器只读不回灌树(不变式 12)。
 */
export const V2ThemeOption = z
  .object({
    subject: z.string().min(1),
    label: z.string().min(1),
    tone: z.string().optional(),
    style: V2Style.optional(),
  })
  .strict();
export type V2ThemeOption = z.infer<typeof V2ThemeOption>;

export const V2ThemeResponse = z
  .object({
    theme: V2Theme,
    cover: z
      .object({
        templateId: z.string(),
        texts: z.record(z.string(), z.string()),
        // Optional: at theme time there's no verified hero photo id, and the agent
        // serializes None out (exclude_none), so the field is simply absent. Keep it
        // optional so a text-only cover passes (was a required-nullable mismatch that
        // made every /theme response fail off-contract → AGENT_INVALID_OUTPUT).
        heroPhotoId: z.string().nullable().optional(),
      })
      .strict()
      .optional(),
    // 主题候选(2-3 个):还没定主题时 Agent 提议这些让用户挑;已定主题时可不返回。
    // 仅供前端展示挑选,不进 draft_json(不变式 12)。
    themeOptions: z.array(V2ThemeOption).min(2).max(3).optional(),
    assistantReply: z.string().max(500),
    usage: Usage,
  })
  .strict();
export type V2ThemeResponse = z.infer<typeof V2ThemeResponse>;

// ── POST /v2/album/chapter-chat(同步;只送本章切片)──
export const V2ChapterChatRequest = z
  .object({
    albumId: z.string().min(1),
    language: V2Language,
    theme: V2Theme.optional(), // 全局基调约束(主题先行)
    chapter: z
      .object({
        chapterId: z.string(),
        state: V2ChapterState,
        cluster: V2Cluster,
        photos: z.array(V2PhotoAnalysis), // 本章照片 analysis(纯文本,无 base64)
        brief: V2Brief.optional(),
        pages: z.array(Page), // 本章骨架页
      })
      .strict(),
    history: z.array(V2ChatTurn).max(20),
    userMessage: z.string().max(500),
  })
  .strict();
export type V2ChapterChatRequest = z.infer<typeof V2ChapterChatRequest>;

export const V2ChapterChatResponse = z
  .object({
    assistantReply: z.string().min(1).max(500),
    chapterBrief: V2Brief.optional(),
    state: V2ChapterState,
    pagesTexts: z
      .array(
        z
          .object({
            pageIndex: z.number().int().nonnegative(),
            texts: z.record(z.string(), z.string()),
          })
          .strict(),
      )
      .optional(),
    // 本章标题候选(editor.html「章节故事」阶段:chipName1-4 让用户挑章节名)。
    // ≤4 个,基于本章照片 analysis + 用户输入,不胡编人名地名事件日期。
    // 仅供前端展示挑选,浏览器只读不回灌树(不变式 12)。
    nameOptions: z.array(z.string().min(1)).max(4).optional(),
    usage: Usage,
  })
  .strict();
export type V2ChapterChatResponse = z.infer<typeof V2ChapterChatResponse>;

// ── POST /v2/album/finalize(异步 202 + callback)──
export const V2FinalizeRequest = z
  .object({
    requestId: z.string().min(1),
    albumId: z.string().min(1),
    callbackUrl: z.string().url(),
    draftTree: AlbumDraft, // 整棵树(无 base64)
  })
  .strict();
export type V2FinalizeRequest = z.infer<typeof V2FinalizeRequest>;

// ── POST /v2/album/add-photos(异步 202 + callback;带 base64)──
// 中途加图(W11):只处理新照片(独立 vision+group+skeleton 成新章节页),不动现有
// 封面/目录/尾页。agent 无需现有 layout —— 模板按新 chapterId 的 stable_hash 选,
// 与现有页无关;Web 侧把返回的新页重排、插到尾页之前。
export const V2AddPhotosRequest = z
  .object({
    requestId: z.string().min(1),
    albumId: z.string().min(1),
    callbackUrl: z.string().url(),
    language: V2Language,
    meta: z.object({ promptHint: z.string().max(500).optional() }).strict().optional(),
    newPhotos: z.array(V2InitPhoto).min(1).max(30),
  })
  .strict();
export type V2AddPhotosRequest = z.infer<typeof V2AddPhotosRequest>;

// ── POST /v2/album/edit(同步;chat-edit 超集 + pickTemplate Tool)──
export const LayoutPatchEntry = z
  .object({
    pageIndex: z.number().int().nonnegative(),
    templateId: z.string().optional(),
    images: z.record(z.string(), z.string()).optional(),
    texts: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export type LayoutPatchEntry = z.infer<typeof LayoutPatchEntry>;

export const V2EditRequest = z
  .object({
    albumId: z.string().min(1),
    currentLayout: AlbumLayoutPlan, // 扁平,通过 zod
    history: z.array(V2ChatTurn).max(20),
    userMessage: z.string().max(500),
    language: V2Language,
    // 用户在编辑器里选中的那一页(W11):有它时,"改这里/这一页"指向该页。
    focusedPageIndex: z.number().int().nonnegative().optional(),
  })
  .strict();
export type V2EditRequest = z.infer<typeof V2EditRequest>;

export const V2EditResponse = z
  .object({
    layoutPatch: z.array(LayoutPatchEntry).min(1).max(48), // 上限对齐 v2 页数边界
    assistantReply: z.string().min(1).max(500),
    usage: Usage,
  })
  .strict();
export type V2EditResponse = z.infer<typeof V2EditResponse>;

// ────────────────────────────── v2 callback envelope ──────────────────────────────
//
// ★ 不能用 z.discriminatedUnion('event', …):两个 variant 同为 event:'completed',
//   单 discriminator 接两个同值分支不合法(评审 P0-1)。
//   两级:completed 内部按 jobKind 判别,外层普通 union(progress/failed 试匹配)。
//   route 必须再断言 payload.jobKind === agent_jobs.kind && payload.requestId === job.request_id。

const V2CallbackError = z.object({ code: z.string().min(1), message: z.string() }).strict();

const V2ProgressEvent = z
  .object({
    requestId: z.string().min(1),
    jobKind: V2JobKind,
    event: z.literal('progress'),
    stage: V2JobStage,
    progress: z.number().int().min(0).max(100),
    message: z.string().optional(),
  })
  .strict();

const V2InitCompleted = z
  .object({
    requestId: z.string().min(1),
    jobKind: z.literal('init'),
    event: z.literal('completed'),
    draftTree: AlbumDraft,
    usage: Usage,
  })
  .strict();

const V2FinalizeCompleted = z
  .object({
    requestId: z.string().min(1),
    jobKind: z.literal('finalize'),
    event: z.literal('completed'),
    layout: AlbumLayoutPlan, // 对外契约,不变
    usage: Usage,
  })
  .strict();

// 中途加图完成:只返回新照片分析 + 新页(pageIndex 局部 0..k,Web 侧重排插入尾页前)。
const V2AddCompleted = z
  .object({
    requestId: z.string().min(1),
    jobKind: z.literal('add'),
    event: z.literal('completed'),
    newPhotos: z.array(PhotoAnalysis), // 5 字段,并入 layoutJson.photos
    newPages: z.array(Page).min(1), // 追加的内容页(不含封面/目录/尾页)
    usage: Usage,
  })
  .strict();

const V2FailedEvent = z
  .object({
    requestId: z.string().min(1),
    jobKind: V2JobKind,
    event: z.literal('failed'),
    error: V2CallbackError,
    stage: V2JobStage.optional(),
    progress: z.number().int().min(0).max(100).optional(),
  })
  .strict();

/** completed 的两形状靠 jobKind 判别。 */
export const V2CompletedCallback = z.discriminatedUnion('jobKind', [
  V2InitCompleted,
  V2FinalizeCompleted,
  V2AddCompleted,
]);
export type V2CompletedCallback = z.infer<typeof V2CompletedCallback>;

export const V2Callback = z.union([V2ProgressEvent, V2FailedEvent, V2CompletedCallback]);
export type V2Callback = z.infer<typeof V2Callback>;
