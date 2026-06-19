import { z } from 'zod';
import { ArtFontPack } from './enums';

export const PhotoOrientation = z.enum(['portrait', 'landscape', 'square']);
export type PhotoOrientation = z.infer<typeof PhotoOrientation>;

export const PhotoQuality = z.enum(['hero', 'detail', 'fill']);
export type PhotoQuality = z.infer<typeof PhotoQuality>;

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
   *   ① **SVG / 空装饰 variableDecor 槽 —— 值即色**:`texts[slotId]` 的值本身就是章节
   *      accentColor,矢量/装饰字形以该色绘制(自包含,无 sibling key)。
   *   ② **持 prose / code-owned 值的 variableDecor 槽 —— sibling carrier 键**:槽内容
   *      逐字保留,章节色/字体改走 `texts[slotId + THEME_ACCENT_CARRIER_SUFFIX]` /
   *      `texts[slotId + THEME_FONT_CARRIER_SUFFIX]`(prose role 见 THEME_USER_PROSE_ROLES)。
   *   ③ **零碰撞**:真实 slotId(普通 id 或 `cells[0].image` bracket-path)均不含 `#`,
   *      carrier 后缀以 `#` 起头,故与任何声明的真实 slotId 不会撞键。
   *   ④ **幂等覆盖**:finalize 对同一棵树重复烘焙得到逐字节相同的 `texts`(覆盖,不追加)。
   */
  texts: z.record(z.string(), z.string()),
  // Optional per-slot position/scale overrides. Absent => render default 50/50/1.
  imagePos: z.record(z.string(), ImagePos).optional(),
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
// §3 隐私红线:**绝不含 `location`/`place`/GPS/坐标任何字段**。Stage 0 只读 `takenAt`
//   (architecture §3 / §6.8 第 3 条),分章只用时间 + 画面整体性信号。

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
 * ⚠️ 无 `location`/`place`/GPS/坐标字段(§3 隐私)。
 */
export const V3ChapterPhoto = z
  .object({
    photoId: z.string().min(1),
    sceneDescription: z.string().max(300), // LLM 写,一句画面描述
    width: z.number().int().positive(), // 代码:输入宽高
    height: z.number().int().positive(), // 代码:输入宽高
    orientation: PhotoOrientation, // 代码:由宽高算
    takenAt: TakenAtDateTime.nullable().optional(), // 代码:EXIF;缺失为 null(无 GPS)
  })
  .strict();
export type V3ChapterPhoto = z.infer<typeof V3ChapterPhoto>;

/**
 * 章节(v3-requirements §4.1):一图一章不跨章,五环节全程复用、绝不重生成。
 *   LLM 写:`description`(主要画面/人物/情绪氛围/地点场景,一段)+ 选图归章。
 *   theme 环节填:`accentColor`(取色)+ `artFont`(字体包内选一);分析期为 null 占位。
 * `accentColor`/`artFont` 与品牌正文字体无关,是排版专用点缀色/艺术字落点。
 */
export const V3Chapter = z
  .object({
    chapterId: z.string().min(1),
    description: z.string().max(600), // LLM 写,章节画面/情绪概述
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
