// Agent V3 contracts — 五环节状态机的 `/v3/*` 端点 req/res + callback。
//
// 真相源(TS),Python `apps/agent/src/schemas.py` 镜像(WP0.3,extra='forbid')。
// 设计基线:docs/architecture.md §2/§3/§6.8 + docs/agent/v3-requirements.md §8/§9。
//
// 硬约定(沿用 v2.ts):本文所有对象一律 `.strict()`(含嵌套),拒未知字段。
//   zod3 的 `.strict()` 只作用于当前层,故每层 object 都显式 `.strict()`。
//   ★ analyze 的 `exif` 必须 strict —— §3 隐私边界执行点(只收 takenAt,拒 lat/lng 坐标;
//     地名也不走 analyze,它经内容采集进树,见 layout.ts V3Chapter.place/chapterContext)。
//   ★ analyze 的 photo 允许 `clusterId`(浏览器本地从 EXIF 时间/GPS 派生的不透明共址/
//     共时标签,c1/c2/…)。§3 2026-07 更新版:**坐标/经纬度任何形式仍严禁**;城市级
//     **地名文字**已放开(浏览器本地反查,坐标不出浏览器),结构化落点只在章节树。
//
// §3 树边界:`/v3/analyze` 回调 + chapter-chat 子树流转用 V3 章节树(authoring);
//   只有 `/v3/finalize` 回扁平 `AlbumLayoutPlan`(渲染契约,不加树形字段)。
import { z } from 'zod';
import { ArtFontPack, TemplateCategory } from './enums';
import {
  AccentColor,
  AlbumLayoutPlan,
  Page,
  PhotoComposition,
  PhotoOrientation,
  TakenAtDateTime,
  V3Chapter,
  V3LayoutTree,
} from './layout';

// ────────────────────────────── 共享 ──────────────────────────────

export const V3Language = z.enum(['zh', 'en']);
export type V3Language = z.infer<typeof V3Language>;

/** V3 async jobs; failures use callback `failed`(§8.3). */
export const V3JobKind = z.enum(['analyze', 'select-layout']);
export type V3JobKind = z.infer<typeof V3JobKind>;

/** analyze 进度子阶段(§4.1 步骤);仅用于 progress 回调展示。 */
export const V3JobStage = z.enum(['describe', 'group', 'template', 'preview', 'layout', 'legalize', 'wrap']);
export type V3JobStage = z.infer<typeof V3JobStage>;

/** 统一 usage,各 `/v3/*` 端点共用(同 v2.ts Usage 形状)。 */
export const V3Usage = z
  .object({
    durationMs: z.number().int().nonnegative(),
    visionCallCount: z.number().int().nonnegative().default(0),
    geminiCallCount: z.number().int().nonnegative().default(0),
    planningInputTokens: z.number().int().nonnegative().default(0),
    planningOutputTokens: z.number().int().nonnegative().default(0),
    repairAttempts: z.number().int().nonnegative().default(0),
    models: z
      .object({ vision: z.string().optional(), planning: z.string().optional() })
      .strict(),
  })
  .strict();
export type V3Usage = z.infer<typeof V3Usage>;

/** 单条对话回合(chapter-chat 历史)。 */
export const V3ChatTurn = z
  .object({ role: z.enum(['user', 'assistant']), content: z.string() })
  .strict();
export type V3ChatTurn = z.infer<typeof V3ChatTurn>;

/** 接单成功响应(异步 analyze 用,§8 接单 5s)。 */
export const V3AcceptedResponse = z
  .object({
    ok: z.literal(true),
    data: z
      .object({ requestId: z.string().min(1), accepted: z.literal(true) })
      .strict(),
  })
  .strict();
export type V3AcceptedResponse = z.infer<typeof V3AcceptedResponse>;

// ───────────────── internal Agent/Web surfaces(PR249 shared boundary) ─────────────────

export const V3InternalAgentDataPageInfoRequest = z
  .object({
    type: z.literal('page-info'),
    albumId: z.string().min(1),
    scope: z.enum(['page', 'chapter']),
    chapterId: z.string().min(1),
    pageIndex: z.coerce.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scope === 'page' && value.pageIndex === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pageIndex'],
        message: 'pageIndex is required when scope=page',
      });
    }
  });
export type V3InternalAgentDataPageInfoRequest = z.infer<typeof V3InternalAgentDataPageInfoRequest>;

export const V3InternalAgentDataChapterSearchRequest = z
  .object({
    type: z.literal('chapter-search'),
    albumId: z.string().min(1),
    query: z.string().trim().min(1),
    limit: z.coerce.number().int().min(1).max(20).default(5),
  })
  .strict();
export type V3InternalAgentDataChapterSearchRequest = z.infer<typeof V3InternalAgentDataChapterSearchRequest>;

export const V3InternalAgentDataPagePhotosRequest = z
  .object({
    type: z.literal('page-photos'),
    albumId: z.string().min(1),
    chapterId: z.string().min(1),
  })
  .strict();
export type V3InternalAgentDataPagePhotosRequest = z.infer<typeof V3InternalAgentDataPagePhotosRequest>;

export const V3InternalAgentDataBookTreeRequest = z
  .object({
    type: z.literal('book-tree'),
    albumId: z.string().min(1),
    chapterId: z.string().min(1).optional(),
    pageIndex: z.coerce.number().int().nonnegative().optional(),
  })
  .strict();
export type V3InternalAgentDataBookTreeRequest = z.infer<typeof V3InternalAgentDataBookTreeRequest>;

export const V3InternalAgentDataRequest = z.union([
  V3InternalAgentDataPageInfoRequest,
  V3InternalAgentDataChapterSearchRequest,
  V3InternalAgentDataPagePhotosRequest,
  V3InternalAgentDataBookTreeRequest,
]);
export type V3InternalAgentDataRequest = z.infer<typeof V3InternalAgentDataRequest>;

export const V3InternalAgentDataPageInfoResponse = z
  .object({
    type: z.literal('page-info'),
    data: z
      .object({
        chapter: V3Chapter,
        pages: z.array(Page),
      })
      .strict(),
  })
  .strict();
export type V3InternalAgentDataPageInfoResponse = z.infer<typeof V3InternalAgentDataPageInfoResponse>;

export const V3InternalAgentDataChapterSearchResponse = z
  .object({
    type: z.literal('chapter-search'),
    data: z
      .object({
        matches: z.array(
          z
            .object({
              chapterId: z.string().min(1),
              pageIndexes: z.array(z.number().int().nonnegative()),
              label: z.string(),
              score: z.number().int().nonnegative(),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();
export type V3InternalAgentDataChapterSearchResponse = z.infer<typeof V3InternalAgentDataChapterSearchResponse>;

export const V3InternalAgentDataPagePhotosResponse = z
  .object({
    type: z.literal('page-photos'),
    data: z
      .object({
        photos: z.array(
          z
            .object({
              photoId: z.string().min(1),
              ref200px: z.string().min(1),
              orientation: PhotoOrientation,
              takenAt: TakenAtDateTime.nullable().optional(),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();
export type V3InternalAgentDataPagePhotosResponse = z.infer<typeof V3InternalAgentDataPagePhotosResponse>;

const V3InternalAgentDataStoryProgress = z
  .object({
    currentChapterId: z.string().min(1).nullable(),
    doneChapterIds: z.array(z.string().min(1)),
  })
  .strict();

export const V3InternalAgentDataBookTreeResponse = z
  .object({
    type: z.literal('book-tree'),
    data: z
      .object({
        progress: V3InternalAgentDataStoryProgress,
        focusedPageIndex: z.number().int().nonnegative().optional(),
        chapters: z.array(
          z
            .object({
              chapterId: z.string().min(1),
              label: z.string(),
              pageIndexes: z.array(z.number().int().nonnegative()),
              done: z.boolean(),
            })
            .strict(),
        ),
        allDone: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type V3InternalAgentDataBookTreeResponse = z.infer<typeof V3InternalAgentDataBookTreeResponse>;

export const V3InternalAgentDataResponse = z.union([
  V3InternalAgentDataPageInfoResponse,
  V3InternalAgentDataChapterSearchResponse,
  V3InternalAgentDataPagePhotosResponse,
  V3InternalAgentDataBookTreeResponse,
]);
export type V3InternalAgentDataResponse = z.infer<typeof V3InternalAgentDataResponse>;

// ───────────────── ① 分析 — POST /v3/analyze(异步 202 + callback) ─────────────────
//
// 唯一带 base64 的端点;入参只 takenAt(§3 隐私)。回调回 V3 章节树 + 套好模板的预览页。

export const V3AnalyzeImageDataUrl = z.string().refine(
  (value) => {
    const match = /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(value);
    if (!match) return false;

    const payload = match[1];
    const padding = payload.length - payload.replace(/=+$/, '').length;
    const unpadded = padding > 0 ? payload.slice(0, -padding) : payload;
    if (padding > 2 || unpadded.includes('=')) return false;
    if (payload.length % 4 !== 0) return false;

    const decodedSize = (payload.length / 4) * 3 - padding;
    return decodedSize <= 800 * 1024;
  },
  { message: 'base64 must be a data:image/(jpeg|png);base64 URL <= 800KB' },
);

const HttpCallbackUrl = z.string().url().refine(
  (value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  },
  { message: 'callbackUrl must be http(s)' },
);

const V3AnalyzePhoto = z
  .object({
    photoId: z.string().min(1),
    base64: V3AnalyzeImageDataUrl, // data:image/(jpeg|png);base64,…  ≤800KB
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    // #232 簇标签:浏览器本地从 EXIF 时间/GPS 派生的不透明共址/共时标签(c1/c2/…),
    //   ★绝不是坐标 —— 只表达「这几张同址同时」,§3 隐私红线允许它、仍禁真实位置字段。
    //   算不出(无 EXIF / 无 GPS)→ null/缺省 → Agent 退化为当前「一大批/模型自由分组」
    //   行为(向后兼容)。`.nullish()`:旧 payload(无此键)与 `null` 均接受。
    clusterId: z.string().min(1).nullish(),
    exif: z
      .object({ takenAt: TakenAtDateTime.nullable().optional() })
      .strict() // ★ 拒 lat/lng/place — §3 隐私执行点
      .optional(),
  })
  .strict();

export const V3AnalyzeRequest = z
  .object({
    requestId: z.string().min(1),
    albumId: z.string().min(1),
    callbackUrl: HttpCallbackUrl,
    language: V3Language,
    meta: z.object({ promptHint: z.string().max(500).optional() }).strict().optional(),
    photos: z.array(V3AnalyzePhoto).min(1).max(100),
  })
  .strict();
export type V3AnalyzeRequest = z.infer<typeof V3AnalyzeRequest>;

// ───────────────── ②0 选版式 — POST /v3/select-layout(异步 202 + callback) ─────────────────
//
// Stage2 consumes the Stage1 tree slice and browser-held 200px refs. The caller
// does not provide template candidates; Agent builds legal candidates internally
// from templates + checked-in template preview assets.

export const SelectLayoutPhoto = z
  .object({
    photoId: z.string().min(1),
    ref200px: V3AnalyzeImageDataUrl,
    orientation: PhotoOrientation,
    composition: PhotoComposition.nullable().optional(), // 来自 Stage1 树;排版按朝向×构图匹配槽位
    takenAt: TakenAtDateTime.nullable(),
    // 照片场景(来自 Stage1 树):排版后一次性写文案时,写作 AI 据它 grounding。旧相册 => ""。
    sceneDescription: z.string().max(300).default(''),
  })
  .strict();
export type SelectLayoutPhoto = z.infer<typeof SelectLayoutPhoto>;

export const SelectLayoutChapter = z
  .object({
    chapterId: z.string().min(1),
    photos: z.array(SelectLayoutPhoto).min(1),
    structureHint: z.string().max(600).optional(),
    // 采访结果:评委据此选贴合基调的版式 + 排版后一次性写文案。跳过采访/老树 => ""。
    chapterContext: z.string().max(500).default(''),
  })
  .strict();
export type SelectLayoutChapter = z.infer<typeof SelectLayoutChapter>;

export const SelectLayoutRequest = z
  .object({
    requestId: z.string().min(1),
    callbackUrl: HttpCallbackUrl,
    language: V3Language,
    chapters: z.array(SelectLayoutChapter).min(1),
  })
  .strict();
export type SelectLayoutRequest = z.infer<typeof SelectLayoutRequest>;

// ── P2 排版评委(rendered-thumbnail judge,two-phase select-layout)──
// Phase 1:Agent 生成候选结构,经 `candidates` 回调交回浏览器去渲染缩略图。
// Phase 2:浏览器把渲染好的小缩略图 POST 回 Agent,Agent 调 Gemini 评委选赢家。

// 候选里的单页结构(simpleId 已还原成真 photoId)。
export const CandidatePage = z
  .object({
    templateId: z.string().min(1),
    images: z.record(z.string(), z.string()), // slotId → photoId
  })
  .strict();
export type CandidatePage = z.infer<typeof CandidatePage>;

// Phase 1 回调里的一个候选(结构,无缩略图)。
export const LayoutCandidate = z
  .object({
    candidateIndex: z.number().int().min(0),
    pages: z.array(CandidatePage).min(1),
  })
  .strict();
export type LayoutCandidate = z.infer<typeof LayoutCandidate>;

// 一个排版单元(一章,或超大章拆出的一段)的候选集合。
export const SelectLayoutCandidateUnit = z
  .object({
    unitKey: z.string().min(1), // chapterId 或 chapterId#段首photoId(拆段唯一)
    chapterId: z.string().min(1),
    candidates: z.array(LayoutCandidate).min(1),
  })
  .strict();
export type SelectLayoutCandidateUnit = z.infer<typeof SelectLayoutCandidateUnit>;

// Phase 2 请求里的一个候选(带渲染缩略图)。
export const JudgeCandidate = z
  .object({
    candidateIndex: z.number().int().min(0),
    thumbnail: z.string().min(1), // data:image/jpeg;base64,...(下采样、仅图槽、无文字)
    pages: z.array(CandidatePage).min(1),
  })
  .strict();
export type JudgeCandidate = z.infer<typeof JudgeCandidate>;

// Phase 2 请求里的一个待评单元。chosenIndex 已定(单候选)则不调评委。
// 写文案素材(评委选完版式后,当场对本章写满文案时用)。只带写作 grounding 需要的
// 字段:photoId(对回图槽)+ sceneDescription(画面依据)。ref200px 那种重图数据不带。
export const JudgeCopyPhoto = z
  .object({
    photoId: z.string().min(1),
    sceneDescription: z.string().max(300).default(''),
    // 拍摄时间(EXIF,来自树)+ 拍摄地点(城市级地名文字,来自 V3Chapter.place,章不跨
    // cluster 故逐照片同值下发)。写文案 AI 据此把时间/地点写进图注。老客户端不带 => null。
    takenAt: TakenAtDateTime.nullable().optional(),
    place: z.string().max(100).nullable().optional(),
  })
  .strict();
export type JudgeCopyPhoto = z.infer<typeof JudgeCopyPhoto>;

export const JudgeLayoutUnit = z
  .object({
    unitKey: z.string().min(1),
    chapterId: z.string().min(1),
    chosenIndex: z.number().int().min(0).optional(),
    candidates: z.array(JudgeCandidate).min(1),
    // 写文案素材:评委选定版式后当场写满本章文案时用。Web 从 draft tree 补(浏览器不持 tree)。
    // 老客户端不带 => 空,写文案退化为只填页码(与今天行为一致,不破坏)。
    photos: z.array(JudgeCopyPhoto).default([]),
    chapterContext: z.string().max(500).default(''),
  })
  .strict();
export type JudgeLayoutUnit = z.infer<typeof JudgeLayoutUnit>;

// POST /v3/judge-layout 请求体(async, 202 + 同一 job-progress 回调)。
export const JudgeLayoutRequest = z
  .object({
    requestId: z.string().min(1),
    callbackUrl: HttpCallbackUrl,
    language: V3Language,
    units: z.array(JudgeLayoutUnit).min(1),
  })
  .strict();
export type JudgeLayoutRequest = z.infer<typeof JudgeLayoutRequest>;

// ───────────── ② 章节故事 — POST /v3/chapter-chat(同步) ─────────────
//
// Web 每次只送单章切片(§8.3),含本章 layout 子树(骨架页)+ history + userMessage。

// 改页的版面补丁(§4.2(3)涉图时):模型出意图、确定性引擎执行后回写整页。
// 与扁平 Page 同形但不含 imagePos 以外的树形字段;templateId/images/texts 局部更新。
export const V3LayoutPatchEntry = z
  .object({
    pageIndex: z.number().int().nonnegative(),
    templateId: z.string().min(1).optional(),
    images: z.record(z.string(), z.string()).optional(),
    texts: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export type V3LayoutPatchEntry = z.infer<typeof V3LayoutPatchEntry>;

// ───────────── ② 章节故事 · Web 完成度状态(WP2.4 / §4.2(1)) ─────────────
//
// 这两个形状描述的是 **Web 侧 `albums.draft_json` 的存储结构**,不是 Agent 端点 req/res:
//   §4.2(1)「Web 持 stage + 当前章 + 各章 done」→ 章级 done + 当前章存哪。
//   stage 列管「五环节走到哪」(architecture §6.8 第 4 条),done 标记的颗粒度是章,
//   存进 draft_json 旁挂的 progress(无新增 DB 迁移)。stage ⟂ status,WP2.4 只写 stage 列。
//
// 兼容:WP1.5(#184)analyze-completed 把**裸 `V3LayoutTree`** 写进 draft_json;WP2.4 读时
//   两种形状都认(裸树 = progress 空初态),首次记 done 才回写成 `{ tree, progress }` 包裹形。

/** ② 章节故事进度:当前章 + 已确定(done)章集合。落 `albums.draft_json`(包裹形)。 */
export const V3StoryProgress = z
  .object({
    // 当前正在推进(尚未确定)的章;为 null = 全部章已确定。
    currentChapterId: z.string().min(1).nullable(),
    // 已「确定」的章 id 集合(章级 done 标记,§4.2(1))。
    doneChapterIds: z.array(z.string().min(1)),
  })
  .strict();
export type V3StoryProgress = z.infer<typeof V3StoryProgress>;

/**
 * `albums.draft_json` 的 V3 包裹形(WP2.4 起):章节树 + 章节故事进度。
 * 与 WP1.5 写入的裸 `V3LayoutTree` 二选一被读;归一化由 Web service 负责(§4.2(1))。
 */
export const V3StoryDraft = z
  .object({
    version: z.literal('v3-story'),
    tree: V3LayoutTree,
    // WP1.5 persists preview pages next to the tree (`{ chapters, pages }`).
    // WP2.4 wraps the tree to add progress, but must keep those pages alive for
    // preview/finalize.
    pages: z.array(Page).optional(),
    progress: V3StoryProgress,
    // 设计环节决策快照(字体三键/颜色三键):设计对话的书级简报(配色主题)从这里取。
    // web 内部消费,engine 不读 draft。
    design: z
      .object({
        fonts: z.record(z.string(), z.string()),
        colors: z.record(z.string(), z.string()),
      })
      .optional(),
  })
  .strict();
export type V3StoryDraft = z.infer<typeof V3StoryDraft>;

// ───────────── ②b 页级编辑 — POST /v3/page-edit(同步,两段式) ─────────────
//
// 两段解耦(docs/superpowers/specs/2026-06-25-page-edit-agent-loop-design.md):
//   段一意图路由(轻调用)判 intent ∈ edit_text|change_layout|advance|talk;段二专门执行
//   (edit_text=一次写作调用 / change_layout=纯确定性 / advance=置标志 / talk=段一 reply)。
// 编辑只作用于聚焦页;完成度由 Agent 代码确定性算(复用 chapter-chat 判定),派生不落库。
// 请求复用 V3ChapterChatRequest 同形字段(降低契约面),响应复用 V3LayoutPatchEntry(不另
//   造补丁形状)。坐标/GPS/经纬度字段禁止(§3 redact 红线;V3Chapter/Page 已 strict。
//   地名文字按 2026-07 口径可出,结构化落点在 V3Chapter.place,不在本端点新增)。

// ───────────── ③ 主题/章节色 · 推荐 — POST /v3/recommend(同步) ─────────────
//
// 承载 Stage4 book theme recommendation: planning model returns exactly three
// book-wide theme options. Each option has one artFont plus one accent color per chapter.

/** 章节概览(每章一条),recommend 的主输入(§8 表)。 */
export const V3ChapterOverview = z
  .object({
    chapterId: z.string().min(1),
    description: z.string().max(600),
    // Stage1 extracted source color. Recommend may use it as evidence, but it is
    // not the final theme `accentColor`.
    extractedColor: AccentColor.nullish(),
    photoDescs: z.array(z.string()).max(12), // 本章各图 sceneDescription(摘要)
  })
  .strict();
export type V3ChapterOverview = z.infer<typeof V3ChapterOverview>;

// ───────────── ③ 主题/章节色 · 应用 — POST /v3/apply-theme(同步,确定性) ─────────────
//
// 无 LLM:把用户选定的每章色/字体一键刷到所有 `variableDecor` 槽(§4.3 / §9),回 layout 补丁。

// ───────────── ④ 书籍设计 — POST /v3/cover(同步,确定性,可选) ─────────────
//
// 选封面/封尾模板 → 自动填充成稿;封面可跳过(§4.4)。空选择 = 跳过,回空补丁。


// ───────────── ⑤ 待导出 — POST /v3/finalize(同步,确定性) ─────────────
//
// 唯一传全树的端点(§8.3):整棵 V3 章节树 → flatten 成扁平 `AlbumLayoutPlan`(烘焙章节色/
//   字体进扁平页,§3 树边界),供 Browser 出 PDF。

// ────────────────────────────── async callback envelope ──────────────────────────────
//
// 沿用 v2 两级判别思路；V3 已有 analyze/select-layout 两类 completed，
// 这里按 event + jobKind 组成普通 union。

const V3CallbackError = z.object({ code: z.string().min(1), message: z.string() }).strict();

const V3ProgressEvent = z
  .object({
    requestId: z.string().min(1),
    jobKind: V3JobKind,
    event: z.literal('progress'),
    stage: V3JobStage,
    progress: z.number().int().min(0).max(100),
    message: z.string().optional(),
  })
  .strict();

const V3AnalyzeCompleted = z
  .object({
    requestId: z.string().min(1),
    jobKind: z.literal('analyze'),
    event: z.literal('completed'),
    // Stage1 tree-only: pages are created later by select-layout using this same requestId.
    tree: V3LayoutTree,
    usage: V3Usage,
  })
  .strict();

export const SelectLayoutCompleted = z
  .object({
    requestId: z.string().min(1),
    jobKind: z.literal('select-layout'),
    event: z.literal('completed'),
    // Stage2 reuses the analyze/init requestId and returns the layout pages that
    // Web merges into draft_json before settling the original job/hold.
    pages: z.array(Page).min(1),
    usage: V3Usage,
  })
  .strict();
export type SelectLayoutCompleted = z.infer<typeof SelectLayoutCompleted>;

// P2 phase 1 回调:Agent 把候选结构交回浏览器去渲染缩略图。不推进 stage,挂住 job。
export const SelectLayoutCandidates = z
  .object({
    requestId: z.string().min(1),
    jobKind: z.literal('select-layout'),
    event: z.literal('candidates'),
    units: z.array(SelectLayoutCandidateUnit).min(1),
    usage: V3Usage,
  })
  .strict();
export type SelectLayoutCandidates = z.infer<typeof SelectLayoutCandidates>;

const V3FailedEvent = z
  .object({
    requestId: z.string().min(1),
    jobKind: V3JobKind,
    event: z.literal('failed'),
    error: V3CallbackError,
    stage: V3JobStage.optional(),
    progress: z.number().int().min(0).max(100).optional(),
  })
  .strict();

export const V3Callback = z.union([
  V3ProgressEvent,
  V3FailedEvent,
  V3AnalyzeCompleted,
  SelectLayoutCompleted,
  SelectLayoutCandidates,
]);
export type V3Callback = z.infer<typeof V3Callback>;

// ─────────────────── select-template 合法候选(§9 / §6) ───────────────────
//
// 模型只在确定性引擎给出的合法候选里挑(category 匹配 + 图片槽数能容纳本组图片数),
//   不凭空造 templateId(§8.3)。此形状供 Agent 内部装配候选集 + 跨端契约一致。

export const V3TemplateCandidate = z
  .object({
    templateId: z.string().min(1),
    category: TemplateCategory,
    imageSlotCount: z.number().int().nonnegative(), // 图片槽总数(含 items 组展开)
  })
  .strict();
export type V3TemplateCandidate = z.infer<typeof V3TemplateCandidate>;

// ───────────── ③ 设计环节 — POST /v3/design(同步) ─────────────
//
// 用户选定封面组后调用:engine 只出决策(字体/颜色/封面封尾文案),
// 应用(carrier sweep/组页/落库)在 Web(状态真相源)。

export const V3DesignTextSlotSpec = z
  .object({
    id: z.string().min(1),
    role: z.string().min(1),
    sample: z.string().max(300).default(''),
  })
  .strict();
export type V3DesignTextSlotSpec = z.infer<typeof V3DesignTextSlotSpec>;

// 每章的设计画像:采访背景 + 识图关键词(V3Chapter.keywords)+ 分组取色
// (V3Chapter.extractedColor)。design_style 据此选贴合内容的字体/颜色。
export const V3DesignChapterProfile = z
  .object({
    // 章标题:写文案环节写进本章页面 title 槽的值(与章节卡片同源)。排版未出/无
    // title 槽 => ''。
    title: z.string().max(120).default(''),
    chapterContext: z.string().max(500).default(''),
    keywords: z.array(z.string().max(40)).default([]),
    extractedColor: AccentColor.nullish(),
  })
  .strict();
export type V3DesignChapterProfile = z.infer<typeof V3DesignChapterProfile>;

export const V3DesignRequest = z
  .object({
    language: V3Language,
    albumTitle: z.string().max(120).default(''),
    // 兼容字段:老 caller 只送 contexts。新 caller 送 chapterProfiles(带 keywords/
    // extractedColor),engine 优先用它。
    chapterContexts: z.array(z.string()).default([]),
    chapterProfiles: z.array(V3DesignChapterProfile).optional(),
    coverSlots: z.array(V3DesignTextSlotSpec).default([]),
    endingSlots: z.array(V3DesignTextSlotSpec).default([]),
  })
  .strict();
export type V3DesignRequest = z.infer<typeof V3DesignRequest>;

// postSyncV3 对 `json.data` 做校验,故这里是数据层 schema(与兄弟端点惯例一致)。
export const V3DesignData = z
  .object({
    fonts: z.object({ title: ArtFontPack, body: ArtFontPack, decoration: ArtFontPack }).strict(),
    colors: z
      .object({
        title: z.string().regex(/^#[0-9a-f]{6}$/),
        body: z.string().regex(/^#[0-9a-f]{6}$/),
        explain: z.string().regex(/^#[0-9a-f]{6}$/),
      })
      .strict(),
    coverTexts: z.record(z.string(), z.string()),
    endingTexts: z.record(z.string(), z.string()),
  })
  .strict();
export type V3DesignData = z.infer<typeof V3DesignData>;
