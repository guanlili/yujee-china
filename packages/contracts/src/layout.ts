import { z } from 'zod';
import { ArtFontPack } from './enums';

export const PhotoOrientation = z.enum(['portrait', 'landscape', 'square']);
export type PhotoOrientation = z.infer<typeof PhotoOrientation>;

export const PhotoQuality = z.enum(['hero', 'detail', 'fill']);
export type PhotoQuality = z.infer<typeof PhotoQuality>;

// 画面构图(识图模型输出,不可由宽高推导):特写/重点/全景。排版按此匹配模板槽位。
export const PhotoComposition = z.enum(['closeup', 'focal', 'wide']);
export type PhotoComposition = z.infer<typeof PhotoComposition>;

// Browser EXIF DateTime is local wall time with no zone. Accept that format
// plus UTC `Z` strings, but keep offset datetimes out so no timezone is invented.
export const TakenAtDateTime = z.string().datetime({ local: true });
export type TakenAtDateTime = z.infer<typeof TakenAtDateTime>;

export const Magazine = z.object({
  title: z.string().min(1).max(60),
  subtitle: z.string().max(100).optional(),
  style: z.string().min(1),
  language: z.enum(['zh', 'en']),
}).strict();
export type Magazine = z.infer<typeof Magazine>;

/**
 * Subject focal point (#169) — the main subject's (face-first) center in the
 * ORIGINAL image, normalized to [0, 1] on each axis (x = left→right,
 * y = top→bottom). Same coordinate space as a CSS object-position fraction, so
 * `{x: focal.x*100, y: focal.y*100}` is a ready-made objectPosition %.
 * Optional; absent => callers fall back to the centered default 0.5/0.5.
 */
export const Focal = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
}).strict();
export type Focal = z.infer<typeof Focal>;

export const PhotoAnalysis = z.object({
  photoId: z.string().min(1),
  description: z.string(),
  tags: z.array(z.string()),
  quality: PhotoQuality,
  orientation: PhotoOrientation,
  // #169: subject focal point (0..1, face-first). Survives finalize so the flat
  // layout's default imagePos can center on the subject. Absent => 0.5/0.5.
  focal: Focal.optional(),
}).strict();
export type PhotoAnalysis = z.infer<typeof PhotoAnalysis>;

/**
 * Per-image render override (#165 Phase 1). Sibling to a page's image slot map:
 * keyed by the SAME slotId the page's `images` map uses (e.g. `image`,
 * `imageTop`, `cells[0].image`). Absent slot => renderer falls back to the
 * historical default (objectPosition 50% 50%, no zoom), so every album authored
 * before this field is byte-unchanged.
 *
 *   x, y  - object-position percentages, clamp range [0, 100] (default 50/50)
 *   scale - zoom factor, clamp range [1, 2] (default 1; applied in BOTH web and PDF render)
 *
 * Clamp bounds are enforced by the writer (#165 Phase 3 adjust_image_position);
 * the schema guards the full range so a hand-rolled payload can't break render.
 */
export const ImagePos = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  scale: z.number().min(1).max(2),
}).strict();
export type ImagePos = z.infer<typeof ImagePos>;

export const Page = z.object({
  pageIndex: z.number().int().nonnegative(),
  templateId: z.string().min(1),
  images: z.record(z.string(), z.string()),
  /**
   * 文字槽内容 + 主题 carrier(§3 树边界 单一真相源,文法见 `./theme-carrier`)。
   *
   * 除真实文字槽文案外,`texts` 还按 theme-carrier 约定携带章节主题(章节色/字体只能
   * 借这张 string map 传递 —— 扁平渲染契约不新增树形字段)。finalize
   * (`finalize_v3._bake_variable_decor`)烘焙、`validate_v3` 校验、渲染器消费:
   *   ① **SVG variableDecor 槽 —— 值即色**:`texts[slotId]` 的值本身就是章节
   *      accentColor,矢量以该色绘制(自包含,无 sibling key)。
   *   ② **TEXT variableDecor 槽 —— sibling carrier 键**:槽内容逐字保留(含空/缺省),
   *      章节色/字体改走 `texts[slotId + THEME_ACCENT_CARRIER_SUFFIX]` /
   *      `texts[slotId + THEME_FONT_CARRIER_SUFFIX]`。
   *   ③ **零碰撞**:真实 slotId(普通 id 或 `cells[0].image` bracket-path)均不含 `#`,
   *      carrier 后缀以 `#` 起头,故与任何声明的真实 slotId 不会撞键。
   *   ④ **幂等覆盖**:finalize 对同一棵树重复烘焙得到逐字节相同的 `texts`(覆盖,不追加)。
   */
  texts: z.record(z.string(), z.string()),
  // Optional per-slot position/scale overrides. Absent/null => render default 50/50/1.
  // `.nullish()` (not just `.optional()`): the Python side serializes `imagePos:
  // dict | None` as JSON `null`, so the V3 analyze callback / finalize payloads
  // carry `null` here — accept it (renderer reads `imagePos?.[slot]`, so null and
  // absent are equivalent). Was `.optional()`, which rejected the agent's `null`.
  imagePos: z.record(z.string(), ImagePos).nullish(),
  /**
   * 页面 HTML 真相(C 方案):已填充的整页 HTML(锚点契约 data-template/
   * data-text-key/data-image-slot;图片 src 一律保持 `{{IMG_SRC:slotId}}` token,
   * 真实 src 渲染时解析 —— base64 绝不落库)。过渡期可选:存量 draft 没有该字段,
   * 读路径按 templateId 现场烘;新落库一律携带。存在 html 时它优先于
   * templateId+texts 的模板渲染,texts 降级为派生缓存(装书校验/搜索用)。
   */
  html: z.string().max(65536).optional(),
}).strict();
export type Page = z.infer<typeof Page>;

export const AlbumLayoutPlan = z.object({
  magazine: Magazine,
  photos: z.array(PhotoAnalysis),
  pages: z.array(Page).min(1),
}).strict();
export type AlbumLayoutPlan = z.infer<typeof AlbumLayoutPlan>;

// ───────────────────────── V3 authoring 树(章节树) ─────────────────────────
//
// §3 树边界:authoring 树只活在交互期(`draft_json`),五环节全程被逐环节"刷新"
//   (v3-requirements §7.1);finalize 时把章节色/字体烘焙进扁平页 → `AlbumLayoutPlan`,
//   **扁平渲染契约不新增任何树形字段**。故 V3 章节树字段全部落在这里、不进 `Page` /
//   `AlbumLayoutPlan`。
//
// §3 隐私红线(2026-07 更新版:「地名文字可出、坐标止步浏览器」):**坐标(lat/lng/GPS/
//   经纬度)任何形式仍严禁**;**城市级地名字符串**已放开 —— 浏览器本地反地理编码
//   (lib/photo/geocode.ts)得出的「杭州」这类文字可以入树(`V3Chapter.place` +
//   `chapterContext` 前缀),坐标本身绝不离开浏览器。分章另可借浏览器派生的不透明
//   `clusterId` 共址/共时标签(#232,见 analyze 入参,绝非坐标)。

/**
 * 章节点缀色(accentColor):每章一个主色,theme 环节由识图模型挑代表图 + 取色工具采样得出,
 * `apply-theme` 一键刷到该章所有 `variableDecor` 槽。`#RGB` / `#RRGGBB` 十六进制。
 */
export const AccentColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
export type AccentColor = z.infer<typeof AccentColor>;

/**
 * 章节树里的单张照片(v3-requirements §4.1)。
 *   LLM 写:`sceneDescription`(一句画面描述)。
 *   代码批量填:`width`/`height`/`orientation`(输入宽高算)、`takenAt`(EXIF)。
 * ⚠️ 坐标(lat/lng/GPS/经纬度)任何形式禁止(§3 隐私);地名走章级 `V3Chapter.place`
 *   (城市级文字),照片级不重复存。簇分组所用的不透明 `clusterId`(#232)只活在
 *   analyze 入参,绝非坐标;此处章节树不携带它。
 */
export const V3ChapterPhoto = z
  .object({
    photoId: z.string().min(1),
    sceneDescription: z.string().max(300), // LLM 写,一句画面描述
    width: z.number().int().positive(), // 代码:输入宽高
    height: z.number().int().positive(), // 代码:输入宽高
    orientation: PhotoOrientation, // 代码:由宽高算
    composition: PhotoComposition.nullable().optional(), // 识图写;排版按朝向×构图匹配槽位。旧树缺失=任意
    takenAt: TakenAtDateTime.nullable().optional(), // 代码:EXIF;缺失为 null(无 GPS)
  })
  .strict();
export type V3ChapterPhoto = z.infer<typeof V3ChapterPhoto>;

/**
 * 章节(v3-requirements §4.1):一图一章不跨章,五环节全程复用、绝不重生成。
 *   `title`:章标识,分析期由拍摄时间跨度确定性派生(如「2024 年 03 月 11–14 日」),
 *     同一棵树内保证不重名。UI 章节卡片/书籍树/检索结果的展示名都读它。
 *   `description`:目录(TOC)专用占位,分析期留空,后期写目录环节才填;
 *     分析/识图阶段不写,也不进下游 AI 上下文(省 token)。
 *   theme 环节填:`accentColor`(取色)+ `artFont`(字体包内选一);分析期为 null 占位。
 * `accentColor`/`artFont` 与品牌正文字体无关,是排版专用点缀色/艺术字落点。
 */
export const V3Chapter = z
  .object({
    chapterId: z.string().min(1),
    // 章标识:分析期确定性派生(拍摄时间跨度 + 地名)。迁移字段:老树无此键
    // (default ""),读取方须降级到 description / `Group N`。
    title: z.string().max(120).default(""),
    description: z.string().max(600).default(""), // 目录占位,分析期留空,后期写目录才填
    // 内容采集(分组后的采访环节)答案:一段自由文字,给排版/写文案当章节背景。
    // Web 把已知的 EXIF 时间/反地理编码地名拼成前缀(如「时间:… 地点:…」),后接用户原话。
    // 迁移字段:老树无此键(default "");坐标绝不进此字段(仅地名文字,§3 隐私)。
    chapterContext: z.string().max(500).default(""),
    // 拍摄地点:城市级地名字符串(如「杭州」「Kyoto」),浏览器本地反地理编码得出
    // (坐标不出浏览器,§3 新口径「地名文字可出」)。章不跨 cluster(#232),故地名挂章级,
    // 写文案时逐照片下发。采访提交时随 chapterContext 一并写回;跳过采访/老树 => ""。
    place: z.string().max(100).default(""),
    // 识图分章关键词(chapter_describer 产物):此前 analyze 用完即丢,现在落树,
    // 设计环节(字体/颜色决策)当每组内容画像用。老树无此键 => []。
    keywords: z.array(z.string().max(40)).default([]),
    // Stage1 extracted source color. Distinct from final theme `accentColor`.
    // Migration field: older trees omit it; Stage1 PR249 trees may carry null.
    extractedColor: AccentColor.nullish(),
    accentColor: AccentColor.nullable(), // 占位 null;theme 环节填
    artFont: ArtFontPack.nullable(), // 占位 null;theme 环节填
    photos: z.array(V3ChapterPhoto),
  })
  .strict();
export type V3Chapter = z.infer<typeof V3Chapter>;

/**
 * V3 章节树根。落 `albums.draft_json`,只活在交互期(§3 树边界)。
 * finalize 时 flatten 成 `AlbumLayoutPlan`(烘焙章节色/字体进扁平页),才进渲染/PDF。
 */
export const V3LayoutTree = z
  .object({
    chapters: z.array(V3Chapter),
  })
  .strict();
export type V3LayoutTree = z.infer<typeof V3LayoutTree>;
