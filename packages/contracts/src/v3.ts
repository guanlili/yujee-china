// Agent V3 contracts — 五环节状态机的 `/v3/*` 端点 req/res + callback。
//
// 真相源(TS),Python `apps/agent/src/schemas.py` 镜像(WP0.3,extra='forbid')。
// 设计基线:docs/architecture.md §2/§3/§6.8 + docs/agent/v3-requirements.md §8/§9。
//
// 硬约定(沿用 v2.ts):本文所有对象一律 `.strict()`(含嵌套),拒未知字段。
//   zod3 的 `.strict()` 只作用于当前层,故每层 object 都显式 `.strict()`。
//   ★ analyze 的 `exif` 必须 strict —— §3 隐私边界执行点(只收 takenAt,拒 lat/lng/place)。
//
// §3 树边界:`/v3/analyze` 回调 + chapter-chat 子树流转用 V3 章节树(authoring);
//   只有 `/v3/finalize` 回扁平 `AlbumLayoutPlan`(渲染契约,不加树形字段)。
import { z } from 'zod';
import { ArtFontPack, TemplateCategory } from './enums';
import {
  AccentColor,
  AlbumLayoutPlan,
  Page,
  TakenAtDateTime,
  V3Chapter,
  V3LayoutTree,
} from './layout';

// ────────────────────────────── 共享 ──────────────────────────────

export const V3Language = z.enum(['zh', 'en']);
export type V3Language = z.infer<typeof V3Language>;

/** V3 唯一异步 job = analyze;失败语义走回调 `failed`(§8.3)。 */
export const V3JobKind = z.enum(['analyze']);
export type V3JobKind = z.infer<typeof V3JobKind>;

/** analyze 进度子阶段(§4.1 步骤);仅用于 progress 回调展示。 */
export const V3JobStage = z.enum(['describe', 'group', 'template', 'preview']);
export type V3JobStage = z.infer<typeof V3JobStage>;

/** 统一 usage,各 `/v3/*` 端点共用(同 v2.ts Usage 形状)。 */
export const V3Usage = z
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

/** 一页文案补丁(章节故事 / 改页回写)。 */
export const V3PageTextsPatch = z
  .object({
    pageIndex: z.number().int().nonnegative(),
    texts: z.record(z.string(), z.string()),
  })
  .strict();
export type V3PageTextsPatch = z.infer<typeof V3PageTextsPatch>;

// ───────────────── ① 分析 — POST /v3/analyze(异步 202 + callback) ─────────────────
//
// 唯一带 base64 的端点;入参只 takenAt(§3 隐私)。回调回 V3 章节树 + 套好模板的预览页。

const V3AnalyzePhoto = z
  .object({
    photoId: z.string().min(1),
    base64: z.string().min(1), // data:image/(jpeg|png);base64,…  ≤800KB
    width: z.number().int().positive(),
    height: z.number().int().positive(),
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
    callbackUrl: z.string().url(),
    language: V3Language,
    meta: z.object({ promptHint: z.string().max(500).optional() }).strict().optional(),
    photos: z.array(V3AnalyzePhoto).min(1).max(30),
  })
  .strict();
export type V3AnalyzeRequest = z.infer<typeof V3AnalyzeRequest>;

// ───────────── ② 章节故事 — POST /v3/chapter-chat(同步) ─────────────
//
// Web 每次只送单章切片(§8.3),含本章 layout 子树(骨架页)+ history + userMessage。

export const V3ChapterChatRequest = z
  .object({
    albumId: z.string().min(1),
    language: V3Language,
    // 本章切片:章节树节点(description/photos/accentColor/artFont)+ 本章骨架页。
    chapter: V3Chapter,
    pages: z.array(Page), // 本章 layout 子树(骨架页,slotId→photoId + 文案槽)
    history: z.array(V3ChatTurn).max(20),
    userMessage: z.string().max(500),
    // 用户在编辑器里选中的那一页(③ 改页):有它时「改这里/这页」指向该页。
    focusedPageIndex: z.number().int().nonnegative().optional(),
  })
  .strict();
export type V3ChapterChatRequest = z.infer<typeof V3ChapterChatRequest>;

/**
 * chapter-chat turn 动作(§4.2(2)):引导/写/改自由交错,Agent 按本次意图分派。
 *   talk = 引导(纯对话,不回补丁);write = 写满全章文案;edit = 改页(文/图)。
 */
export const V3ChapterChatKind = z.enum(['talk', 'write', 'edit']);
export type V3ChapterChatKind = z.infer<typeof V3ChapterChatKind>;

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

export const V3ChapterChatResponse = z
  .object({
    kind: V3ChapterChatKind,
    assistantReply: z.string().min(1).max(500),
    // 仅 kind=='write':一次性写满本章全部页文案(§4.2(2))。
    pagesTexts: z.array(V3PageTextsPatch).optional(),
    // 仅 kind=='edit' 且涉版面:确定性引擎执行后的整页补丁(§4.2(3))。
    layoutPatch: z.array(V3LayoutPatchEntry).optional(),
    // 本章标题候选(≤4),供前端展示挑选;不回灌树(§3 数据归属)。
    nameOptions: z.array(z.string().min(1)).max(4).optional(),
    usage: V3Usage,
  })
  .strict();
export type V3ChapterChatResponse = z.infer<typeof V3ChapterChatResponse>;

// ───────────── ③ 主题/章节色 · 推荐 — POST /v3/recommend(同步) ─────────────
//
// 承载 recommend-theme + recommend-chapter-colors 两 Skill(§6)。识图模型出候选,用户挑。

/** 章节概览(每章一条),recommend 的主输入(§8 表)。 */
export const V3ChapterOverview = z
  .object({
    chapterId: z.string().min(1),
    description: z.string().max(600),
    photoDescs: z.array(z.string()).max(12), // 本章各图 sceneDescription(摘要)
  })
  .strict();
export type V3ChapterOverview = z.infer<typeof V3ChapterOverview>;

export const V3RecommendRequest = z
  .object({
    albumId: z.string().min(1),
    language: V3Language,
    chapters: z.array(V3ChapterOverview).min(1),
    analysisSummary: z.string().max(1000).optional(), // 分析摘要(全局基调)
    userMessage: z.string().max(500).optional(),
  })
  .strict();
export type V3RecommendRequest = z.infer<typeof V3RecommendRequest>;

/** 主题候选(供用户挑,不进树)。 */
export const V3ThemeOption = z
  .object({
    subject: z.string().min(1),
    label: z.string().min(1),
    tone: z.string().optional(),
  })
  .strict();
export type V3ThemeOption = z.infer<typeof V3ThemeOption>;

/** 每章推荐色 + 字体(用户确认后由 apply-theme 写树)。 */
export const V3ChapterColorRecommendation = z
  .object({
    chapterId: z.string().min(1),
    accentColor: AccentColor,
    artFont: ArtFontPack,
  })
  .strict();
export type V3ChapterColorRecommendation = z.infer<typeof V3ChapterColorRecommendation>;

export const V3RecommendResponse = z
  .object({
    themeOptions: z.array(V3ThemeOption).min(1).max(3),
    chapterColors: z.array(V3ChapterColorRecommendation).min(1),
    assistantReply: z.string().max(500),
    usage: V3Usage,
  })
  .strict();
export type V3RecommendResponse = z.infer<typeof V3RecommendResponse>;

// ───────────── ③ 主题/章节色 · 应用 — POST /v3/apply-theme(同步,确定性) ─────────────
//
// 无 LLM:把用户选定的每章色/字体一键刷到所有 `variableDecor` 槽(§4.3 / §9),回 layout 补丁。

/** 用户选定的每章色/字体(写入章节树)。 */
export const V3ChapterThemeChoice = z
  .object({
    chapterId: z.string().min(1),
    accentColor: AccentColor,
    artFont: ArtFontPack,
  })
  .strict();
export type V3ChapterThemeChoice = z.infer<typeof V3ChapterThemeChoice>;

export const V3ApplyThemeRequest = z
  .object({
    albumId: z.string().min(1),
    language: V3Language,
    theme: V3ThemeOption, // 用户选定的主题
    chapters: z.array(V3ChapterThemeChoice).min(1),
    // 受影响的 layout 子树(③④传相关页,§8.3);apply 把 variableDecor 槽刷上色/字体。
    pages: z.array(Page),
  })
  .strict();
export type V3ApplyThemeRequest = z.infer<typeof V3ApplyThemeRequest>;

export const V3ApplyThemeResponse = z
  .object({
    // 刷完 variableDecor 槽(章节色/字体/SVG 点缀)后的整页补丁(§3 树边界:仍是页级)。
    layoutPatch: z.array(V3LayoutPatchEntry).min(1),
    assistantReply: z.string().max(500).optional(),
    usage: V3Usage,
  })
  .strict();
export type V3ApplyThemeResponse = z.infer<typeof V3ApplyThemeResponse>;

// ───────────── ④ 书籍设计 — POST /v3/cover(同步,确定性,可选) ─────────────
//
// 选封面/封尾模板 → 自动填充成稿;封面可跳过(§4.4)。空选择 = 跳过,回空补丁。

export const V3CoverRequest = z
  .object({
    albumId: z.string().min(1),
    language: V3Language,
    // 选定的封面/封尾模板;null = 跳过该项(封面可选,§4.4)。
    coverTemplateId: z.string().min(1).nullable().optional(),
    endingTemplateId: z.string().min(1).nullable().optional(),
    pages: z.array(Page), // 相关页(供自动填充取图/文)
  })
  .strict();
export type V3CoverRequest = z.infer<typeof V3CoverRequest>;

export const V3CoverResponse = z
  .object({
    // 封面/封尾页补丁;跳过时为空数组(§4.4「跳过=空」)。
    layoutPatch: z.array(V3LayoutPatchEntry),
    assistantReply: z.string().max(500).optional(),
    usage: V3Usage,
  })
  .strict();
export type V3CoverResponse = z.infer<typeof V3CoverResponse>;

// ───────────── ⑤ 待导出 — POST /v3/finalize(同步,确定性) ─────────────
//
// 唯一传全树的端点(§8.3):整棵 V3 章节树 → flatten 成扁平 `AlbumLayoutPlan`(烘焙章节色/
//   字体进扁平页,§3 树边界),供 Browser 出 PDF。

export const V3FinalizeRequest = z
  .object({
    albumId: z.string().min(1),
    language: V3Language,
    tree: V3LayoutTree, // 整棵章节树(无 base64)
    pages: z.array(Page).min(1), // 全部 layout 页(各章骨架页 + 封面/封尾)
  })
  .strict();
export type V3FinalizeRequest = z.infer<typeof V3FinalizeRequest>;

export const V3FinalizeResponse = z
  .object({
    layout: AlbumLayoutPlan, // 扁平定稿(对外渲染契约,不加树形字段)
    usage: V3Usage,
  })
  .strict();
export type V3FinalizeResponse = z.infer<typeof V3FinalizeResponse>;

// ────────────────────────────── analyze callback envelope ──────────────────────────────
//
// 沿用 v2 两级判别思路,但 V3 只有 analyze 一种 completed,故按 event 普通 union 即可。

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
    // 预览态产物:V3 章节树 + 套好模板/填好通用文案-色的页。
    tree: V3LayoutTree,
    pages: z.array(Page).min(1),
    usage: V3Usage,
  })
  .strict();

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
