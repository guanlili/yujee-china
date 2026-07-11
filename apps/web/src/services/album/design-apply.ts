import { TEMPLATES, THEME_ACCENT_CARRIER_SUFFIX, THEME_FONT_CARRIER_SUFFIX } from '@yujee/contracts';
import type { Page } from '@yujee/contracts';
import { bakePagesHtml } from './bake-html';

// 设计环节的确定性应用层(纯函数,零 AI):封面组规则生成、模板文字槽 spec 提取、
// carrier sweep、成书页序组装。AI 决策(字体/颜色/封面封尾文案)在 engine /v3/design;
// 这里把决策落到 draft pages 上 —— Web 是状态真相源。

export type CoverSet = {
  coverTemplateId: string;
  coverPhotoId: string;
  endingTemplateId: string;
  endingPhotoId: string;
};

export type DesignFonts = { title: string; body: string; decoration: string };
export type DesignColors = { title: string; body: string; explain: string };

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

// 封面组规则生成:cover 模板(按 albumId 确定性轮换取 2)× hero 照片(2)= 至多 4 组;
// 封尾统一(ending 类目当前仅 mag-20),配第二张 hero(与该组封面不同则用之,否则同张)。
export function buildCoverSets(albumId: string, chapters: TreeChapter[]): CoverSet[] {
  const heroes = pickHeroPhotos(chapters, 2);
  if (heroes.length === 0) return [];
  const coverIds = templateIdsByCategory('cover').filter((id) => firstImageSlotId(id));
  const endingIds = templateIdsByCategory('ending');
  if (coverIds.length === 0 || endingIds.length === 0) return [];
  const offset = [...albumId].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % coverIds.length;
  const rotated = [...coverIds.slice(offset), ...coverIds.slice(0, offset)].slice(0, 2);
  const ending = endingIds[0];
  const sets: CoverSet[] = [];
  for (const coverTemplateId of rotated) {
    for (const coverPhotoId of heroes) {
      sets.push({
        coverTemplateId,
        coverPhotoId,
        endingTemplateId: ending,
        endingPhotoId: heroes.find((id) => id !== coverPhotoId) ?? coverPhotoId,
      });
    }
  }
  return sets;
}

// 模板文字槽 spec(engine DesignRequest 的 coverSlots/endingSlots 入参)。
export function slotSpecs(
  templateId: string,
): Array<{ id: string; role: string; sample: string; maxChars?: number }> {
  const template = templateOf(templateId);
  return (template?.texts ?? []).map((slot) => {
    const maxChars = (slot as { maxChars?: unknown }).maxChars;
    return {
      id: slot.id,
      role: slot.role,
      sample: typeof (slot as { sample?: unknown }).sample === 'string' ? (slot as { sample: string }).sample : '',
      // 字数预算透传给文案模型(可选;模板没声明就不传)。
      ...(typeof maxChars === 'number' && Number.isInteger(maxChars) && maxChars > 0 ? { maxChars } : {}),
    };
  });
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
export function assembleDesignedPages(input: {
  interiorPages: Page[];
  set: CoverSet;
  coverTexts: Record<string, string>;
  endingTexts: Record<string, string>;
  fonts: DesignFonts;
  colors: DesignColors;
}): Page[] {
  const coverSlot = firstImageSlotId(input.set.coverTemplateId);
  const endingSlot = firstImageSlotId(input.set.endingTemplateId);
  const cover: Page = {
    pageIndex: 0,
    templateId: input.set.coverTemplateId,
    images: coverSlot ? { [coverSlot]: input.set.coverPhotoId } : {},
    texts: { ...input.coverTexts },
  };
  const ending: Page = {
    pageIndex: 0,
    templateId: input.set.endingTemplateId,
    images: endingSlot ? { [endingSlot]: input.set.endingPhotoId } : {},
    texts: { ...input.endingTexts },
  };
  const ordered = [cover, ...input.interiorPages, ending].map((page, idx) => ({
    ...page,
    pageIndex: idx,
  }));
  const swept = sweepCarriers(ordered, input.fonts, input.colors);
  // C 方案:carrier sweep 改了 texts,已烘的 html 失效 —— 清掉重烘,设计结果
  // (字体/颜色/封面封尾文案)烘进页面真相。lenient 为迁移过渡期(见 bake-html)。
  return bakePagesHtml(swept.map((page) => ({ ...page, html: undefined }))) as Page[];
}
