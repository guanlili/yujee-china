import { TEMPLATES, THEME_ACCENT_CARRIER_SUFFIX, THEME_FONT_CARRIER_SUFFIX } from '@yujee/contracts';
import type { Page } from '@yujee/contracts';
import { bakePagesHtml } from './bake-html';
import { patchHtmlPageStyle } from '@/components/album/page-html-dom';
import { PAGE_BACKGROUNDS, isDefaultPageBackground } from '@/lib/design/page-backgrounds';

// 设计环节的确定性应用层(纯函数,零 AI):封面组规则生成、模板文字槽 spec 提取、
// carrier sweep、成书页序组装。AI 决策(全书文案/封面封尾文案/字体)在 engine /v3/compose;
// 这里把决策落到 draft pages 上 —— Web 是状态真相源。

export type CoverSet = {
  coverTemplateId: string;
  coverPhotoId: string;
  endingTemplateId: string;
  endingPhotoId: string;
  // 每套推荐封面自带一个书页底色(4 套 × 4 色,一一对应);选定后刷全书。
  // 可选:老调用/内部组页(用 applyDesign 的 pageBackground 入参)不必带。
  pageBackground?: string;
};

export type DesignFonts = { title: string; body: string; decoration: string };
export type DesignColors = { title: string; body: string; explain: string };

// 三色恒黑:模板自带的文字色就是它(见 html-templates 里的 `{{COLOR:*|#1c1b18}}`)。
// compose 不再让模型选颜色(旧 /v3/design 出的三色实测也恒是这个值),Web 确定性填。
export const DESIGN_TEXT_COLOR = '#1c1b18';
export const DESIGN_COLORS: DesignColors = {
  title: DESIGN_TEXT_COLOR,
  body: DESIGN_TEXT_COLOR,
  explain: DESIGN_TEXT_COLOR,
};

// 字体兜底(与 engine compose handler `_DEFAULT_FONTS` 同值):compose 极端兜底可能
// 回空 fonts,carrier sweep 不能因此写空 —— Web 侧自带确定性默认。
const DEFAULT_FONTS: Record<'zh' | 'en', DesignFonts> = {
  zh: { title: 'noto-serif-sc', body: 'noto-serif-sc', decoration: 'great-vibes' },
  en: { title: 'playfair-display', body: 'eb-garamond', decoration: 'great-vibes' },
};

/** compose 回来的 fonts(可能缺键/空串/整体为空)→ 三键齐全的确定性字体。 */
export function normalizeDesignFonts(
  fonts: Record<string, string> | null | undefined,
  language: 'zh' | 'en',
): DesignFonts {
  const fallback = DEFAULT_FONTS[language] ?? DEFAULT_FONTS.en;
  const pick = (key: keyof DesignFonts): string => {
    const value = fonts?.[key];
    return typeof value === 'string' && value.trim() !== '' ? value : fallback[key];
  };
  return { title: pick('title'), body: pick('body'), decoration: pick('decoration') };
}

/**
 * 逐槽合并文案:只覆盖 incoming 里**非空**的槽,其余保留 base(模板 sample)。
 * compose 的 coverTexts/endingTexts 会把模型没写出来的槽带着空串回来 —— 无脑写回
 * 会把封面从 sample 示例文案洗成空白,所以空串一律忽略。
 */
export function mergeSlotTexts(
  base: Record<string, string>,
  incoming: Record<string, string> | null | undefined,
): Record<string, string> {
  const out = { ...base };
  for (const [slotId, text] of Object.entries(incoming ?? {})) {
    if (typeof text !== 'string' || text.trim() === '') continue;
    out[slotId] = text;
  }
  return out;
}

/** 模板自带的示例文案(逐槽 sample):封面/封尾组页的文案底稿,模型没写的槽留它。 */
export function sampleTexts(templateId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slot of templateOf(templateId)?.texts ?? []) {
    const sample = (slot as { sample?: unknown }).sample;
    if (typeof sample === 'string' && sample !== '') out[slot.id] = sample;
  }
  return out;
}

/**
 * 封面/封尾文案的兜底底稿:**只**保留 role=title 槽的 sample。
 *
 * 其余槽(body/explain/decoration)宁可空着 —— 那些槽的 sample 是模板作者写的
 * 具体年份和地名(mag-23 的 "2026\n2025\n2024" / "Shanghai \nBeijing\nDali"),
 * 模型没写出来时回落 sample 等于把别人的年份地名印在用户的书上,比空着更糟。
 * 标题槽例外:封面没有大标题是废版面,必须留兜底。
 */
export function coverTextBase(templateId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slot of templateOf(templateId)?.texts ?? []) {
    if (slot.role !== 'title') continue;
    const sample = (slot as { sample?: unknown }).sample;
    if (typeof sample === 'string' && sample !== '') out[slot.id] = sample;
  }
  return out;
}

/**
 * compose 的 `pagesTexts`({[pageIndex]: {[slotId]: 文案}})逐槽写回内页。
 * · 逐槽覆盖,不整页替换 —— 模型没写的槽保留模板 sample;
 * · 没出现在 pagesTexts 里的页原样保留(某章写不出来也照常成稿,硬约束落点)。
 */
export function applyComposePagesTexts(
  pages: Page[],
  pagesTexts: Record<string, Record<string, string>> | null | undefined,
): Page[] {
  if (!pagesTexts || Object.keys(pagesTexts).length === 0) return pages;
  return pages.map((page) => {
    const incoming = pagesTexts[String(page.pageIndex)];
    if (!incoming) return page;
    return { ...page, texts: mergeSlotTexts(page.texts, incoming) };
  });
}

type TreePhoto = { photoId: string; composition?: string | null };
type TreeChapter = { photos: TreePhoto[] };

function templateOf(id: string) {
  return (TEMPLATES as Record<string, (typeof TEMPLATES)[keyof typeof TEMPLATES]>)[id];
}

export function templateCategory(templateId: string): string | undefined {
  return templateOf(templateId)?.category;
}

function templateIdsByCategory(category: string): string[] {
  return Object.values(TEMPLATES)
    .filter((t) => t.category === category)
    .map((t) => t.id)
    .sort();
}

function firstImageSlotId(templateId: string): string | undefined {
  return templateOf(templateId)?.images?.[0]?.id;
}

// hero 照片:构图 focal > closeup > 其余,取前 N 张(与 engine 封面候选同规则)。
export function pickHeroPhotos(chapters: TreeChapter[], count: number): string[] {
  const rank: Record<string, number> = { focal: 0, closeup: 1 };
  const photos = chapters.flatMap((c) => c.photos ?? []);
  return [...photos]
    .sort((a, b) => (rank[a.composition ?? ''] ?? 2) - (rank[b.composition ?? ''] ?? 2))
    .slice(0, count)
    .map((p) => p.photoId);
}

// 封尾模板:优先「有文字槽」的封底(engine 写的封尾文案要有槽可落;纯图 ending 会让
// 文案全部落空),按 albumId 确定性轮换;库里没有带文字槽的 ending 才退回纯图。
export function pickEndingTemplateId(albumId: string): string | undefined {
  const all = templateIdsByCategory('ending').filter((id) => firstImageSlotId(id));
  const withText = all.filter((id) => (templateOf(id)?.texts ?? []).length > 0);
  const pool = withText.length > 0 ? withText : all;
  if (pool.length === 0) return undefined;
  const offset = [...albumId].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % pool.length;
  return pool[offset];
}

// 封面组规则生成:cover 模板(按 albumId 确定性轮换取 2)× hero 照片(2)= 至多 4 组;
// 封尾统一用 pickEndingTemplateId(带文字槽优先),配第二张 hero(与该组封面不同则用之,否则同张)。
export function buildCoverSets(albumId: string, chapters: TreeChapter[]): CoverSet[] {
  const heroes = pickHeroPhotos(chapters, 2);
  if (heroes.length === 0) return [];
  const coverIds = templateIdsByCategory('cover').filter((id) => firstImageSlotId(id));
  const ending = pickEndingTemplateId(albumId);
  if (coverIds.length === 0 || !ending) return [];
  // 推荐按【样式】变而非按照片变(用户拍板 2026-07-16):展示至多 4 个【不同样式】的封面,
  // 封面照片统一用同一张 hero(可重复;用户若只是嫌图片不好会自己换)。rotate 让不同相册的
  // 展示顺序不同,但每本都能看到全部样式。封尾配另一张 hero(只有一张时退回同一张)。
  const offset = [...albumId].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % coverIds.length;
  const rotated = [...coverIds.slice(offset), ...coverIds.slice(0, offset)].slice(0, 4);
  const coverPhotoId = heroes[0];
  const endingPhotoId = heroes.find((id) => id !== coverPhotoId) ?? coverPhotoId;
  // 每套按序绑一个书页底色:第 1 套→纯白、第 2 套→象牙白…(PAGE_BACKGROUNDS 顺序)。
  // 4 套 × 4 色一一对应;用户选哪套 = 连那套底色一起刷全书。
  return rotated.map((coverTemplateId, i) => ({
    coverTemplateId,
    coverPhotoId,
    endingTemplateId: ending,
    endingPhotoId,
    pageBackground: PAGE_BACKGROUNDS[i % PAGE_BACKGROUNDS.length]!.hex,
  }));
}

// 模板文字槽 spec(engine DesignRequest 的 coverSlots/endingSlots 入参)。
export function slotSpecs(
  templateId: string,
): Array<{ id: string; role: string; sample: string }> {
  const template = templateOf(templateId);
  // 不传字数上限:模板不再声明。篇幅由 sample 示范(它就是该槽在版面上的实际长度参考),
  // 写长了不裁 —— 渲染层的 fit-text 会自动缩字号装下。
  return (template?.texts ?? []).map((slot) => ({
    id: slot.id,
    role: slot.role,
    sample: typeof (slot as { sample?: unknown }).sample === 'string' ? (slot as { sample: string }).sample : '',
  }));
}

// carrier sweep:按模板声明的文字槽 role,把三键字体/颜色写成 `${slotId}#artFont` /
// `${slotId}#accentColor`(web/PDF 渲染端 theme-carrier 消费的同一格式)。
// decoration 颜色跟标题色(与 design-agent set_text_colors 口径一致)。
export function sweepCarriers(pages: Page[], fonts: DesignFonts, colors: DesignColors): Page[] {
  const fontByRole: Record<string, string> = {
    title: fonts.title,
    body: fonts.body,
    explain: fonts.body,
    decoration: fonts.decoration,
  };
  const colorByRole: Record<string, string> = {
    title: colors.title,
    body: colors.body,
    explain: colors.explain,
    decoration: colors.title,
  };
  return pages.map((page) => {
    const template = templateOf(page.templateId);
    if (!template) return page;
    const texts = { ...page.texts };
    for (const slot of template.texts ?? []) {
      const font = fontByRole[slot.role];
      const color = colorByRole[slot.role];
      if (font) texts[`${slot.id}${THEME_FONT_CARRIER_SUFFIX}`] = font;
      if (color) texts[`${slot.id}${THEME_ACCENT_CARRIER_SUFFIX}`] = color;
    }
    return { ...page, texts };
  });
}

// 成书组装:封面在前、封尾在后,内页居中,pageIndex 全书重排。
// extraEndingPhotoIds:封底模板可能有多个图槽(如 mag-22 两图),第 1 槽用 endingPhotoId,
// 其余槽按序取补充照片,不够则复用最后一张 —— 图槽绝不留空。
export function assembleDesignedPages(input: {
  interiorPages: Page[];
  set: CoverSet;
  coverTexts: Record<string, string>;
  endingTexts: Record<string, string>;
  fonts: DesignFonts;
  colors: DesignColors;
  extraEndingPhotoIds?: string[];
  // 书页底色:用户在封面选择卡里选的 4 色之一,刷全书每页页根 background-color。
  // 纯白/未传 = 不写(留模板默认),见 applyPageBackground。
  pageBackground?: string;
}): Page[] {
  const coverSlot = firstImageSlotId(input.set.coverTemplateId);
  const endingSlotIds = (templateOf(input.set.endingTemplateId)?.images ?? []).map((s) => s.id);
  const endingPool = [
    input.set.endingPhotoId,
    ...(input.extraEndingPhotoIds ?? []).filter((id) => id !== input.set.endingPhotoId),
  ];
  const cover: Page = {
    pageIndex: 0,
    templateId: input.set.coverTemplateId,
    images: coverSlot ? { [coverSlot]: input.set.coverPhotoId } : {},
    texts: { ...input.coverTexts },
  };
  const ending: Page = {
    pageIndex: 0,
    templateId: input.set.endingTemplateId,
    images: Object.fromEntries(
      endingSlotIds.map((slotId, i) => [slotId, endingPool[Math.min(i, endingPool.length - 1)]]),
    ),
    texts: { ...input.endingTexts },
  };
  const ordered = [cover, ...input.interiorPages, ending].map((page, idx) => ({
    ...page,
    pageIndex: idx,
  }));
  const swept = sweepCarriers(ordered, input.fonts, input.colors);
  // C 方案:carrier sweep 改了 texts,已烘的 html 失效 —— 清掉重烘,设计结果
  // (字体/颜色/封面封尾文案)烘进页面真相。lenient 为迁移过渡期(见 bake-html)。
  const baked = bakePagesHtml(swept.map((page) => ({ ...page, html: undefined }))) as Page[];
  return applyPageBackground(baked, input.pageBackground);
}

// 书页底色 sweep:烘完 html 后,给每页页根 [data-template] 写 background-color。
// 与手动书页背景工具同一原语(patchHtmlPageStyle),纯字符串实现,服务端可跑。
// 纯白/未传 = 不写(留模板自带 background:#fff);锚点失配的页原样保留(不影响其余页)。
function applyPageBackground(pages: Page[], bg?: string): Page[] {
  if (!bg || isDefaultPageBackground(bg)) return pages;
  return pages.map((page) => {
    if (typeof page.html !== 'string') return page;
    const patched = patchHtmlPageStyle(page.html, { 'background-color': bg });
    return patched ? { ...page, html: patched } : page;
  });
}
