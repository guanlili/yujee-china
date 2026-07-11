// 加照片增量重跑(spec .claude/specs/2026-07-11-*)的确定性合并层(纯函数,零 IO):
// 新章节树合并进 draft、新页插进成书(封尾前)、从已有页反提取设计三键。
// AI/网络都不在这里;回调侧(job-service)只做编排。
import { TEMPLATES, THEME_ACCENT_CARRIER_SUFFIX, THEME_FONT_CARRIER_SUFFIX } from '@yujee/contracts';
import type { Page, V3LayoutTree, V3StoryDraft } from '@yujee/contracts';
import { templateCategory, type DesignColors, type DesignFonts } from './design-apply';

// 新章节 id 重映射:统一加 tag 前缀(建议 add+requestId 前 8 位),与既有章节撞号时
// 继续叠 x 前缀。返回新数组,入参不变。
export function remapAppendChapterIds<T extends { chapterId: string }>(
  chapters: T[],
  existingIds: ReadonlySet<string>,
  tag: string,
): T[] {
  const taken = new Set(existingIds);
  return chapters.map((c) => {
    let next = `${tag}-${c.chapterId}`;
    while (taken.has(next)) next = `x${next}`;
    taken.add(next);
    return { ...c, chapterId: next };
  });
}

// 新章节追加到树尾;老章都完成(cursor 空)时把 cursor 指到第一个新章,驱动前端进入
// 采访;老章还在采访/确认中则不打断(新章排在其后自然轮到)。pages/done 原样保留。
export function mergeAppendTree(
  draft: V3StoryDraft,
  newChapters: V3LayoutTree['chapters'],
): V3StoryDraft {
  return {
    ...draft,
    tree: { ...draft.tree, chapters: [...draft.tree.chapters, ...newChapters] },
    progress: {
      ...draft.progress,
      currentChapterId: draft.progress.currentChapterId ?? newChapters[0]?.chapterId ?? null,
    },
  };
}

// 新页插到封尾页(ending 类目)之前;无封尾则追尾。pageIndex 全书重排。
export function insertAppendPages(existing: Page[], appended: Page[]): Page[] {
  const endingAt = existing.findIndex((p) => templateCategory(p.templateId) === 'ending');
  const head = endingAt === -1 ? existing : existing.slice(0, endingAt);
  const tail = endingAt === -1 ? [] : existing.slice(endingAt);
  return [...head, ...appended, ...tail].map((page, idx) => ({ ...page, pageIndex: idx }));
}

// 从已有页反提取设计三键(sweepCarriers 的逆):按模板声明的文字槽 role 读 carrier 键。
// decoration 颜色与 title 同源(sweepCarriers 口径),故颜色只需 title/body/explain。
// 全书无任何 carrier(设计未做过)→ null,调用方让新页保持默认、等将来 applyDesign 覆盖。
export function extractDesignFromPages(
  pages: Page[],
): { fonts: DesignFonts; colors: DesignColors } | null {
  const fonts: Partial<DesignFonts> = {};
  const colors: Partial<DesignColors> = {};
  let explainColor: string | undefined;
  for (const page of pages) {
    const template = (
      TEMPLATES as Record<string, { texts?: Array<{ id: string; role: string }> } | undefined>
    )[page.templateId];
    for (const slot of template?.texts ?? []) {
      const font = page.texts[`${slot.id}${THEME_FONT_CARRIER_SUFFIX}`];
      const color = page.texts[`${slot.id}${THEME_ACCENT_CARRIER_SUFFIX}`];
      if (slot.role === 'title') {
        if (font) fonts.title ??= font;
        if (color) colors.title ??= color;
      } else if (slot.role === 'body') {
        if (font) fonts.body ??= font;
        if (color) colors.body ??= color;
      } else if (slot.role === 'explain') {
        if (font) fonts.body ??= font; // sweep 口径:explain 字体=body 字体
        if (color) explainColor ??= color;
      } else if (slot.role === 'decoration') {
        if (font) fonts.decoration ??= font;
      }
    }
  }
  if (!fonts.title && !fonts.body && !colors.title && !colors.body) return null;
  const resolvedFonts: DesignFonts = {
    title: fonts.title ?? fonts.body ?? '',
    body: fonts.body ?? fonts.title ?? '',
    decoration: fonts.decoration ?? fonts.title ?? fonts.body ?? '',
  };
  const resolvedColors: DesignColors = {
    title: colors.title ?? colors.body ?? explainColor ?? '',
    body: colors.body ?? colors.title ?? explainColor ?? '',
    explain: explainColor ?? colors.body ?? colors.title ?? '',
  };
  if (!resolvedFonts.title || !resolvedColors.title) return null;
  return { fonts: resolvedFonts, colors: resolvedColors };
}

export function countTreePhotos(
  chapters: ReadonlyArray<{ photos: readonly unknown[] }>,
): number {
  return chapters.reduce((sum, chapter) => sum + chapter.photos.length, 0);
}
