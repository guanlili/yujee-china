/* ════════════════════════════════════════════════════════════════════════════
   browse-window —— 浏览态「这一屏显示什么」。纯函数,不碰 DOM。

   旧实现是对桌面 renderOverview 产出的格子做 display:none(mobile-canvas.ts),
   桌面每次重建 innerHTML 都会把它冲刷掉,得追着重贴。移动端有了自己的 UI 树之后,
   这件事退化成一次普通计算:输入开页表 + 页游标 + 密度,输出该渲染哪些开页。

   开页表复用桌面同一份 buildSpreads —— 封面开在右手页、封底收在左手页这类规则
   只能有一份实现,移动端另写一套迟早会和桌面漂移。

   分屏规则:密度是【开页】单位(1=单页 / 2=一个开页 / 4=两个开页竖排),但
   **封面、封底(独页 solo)在任何密度下都单页独占一屏** —— 否则密度 4 会把一个
   窄独页和一个宽对页塞进同一屏,又小又不齐。分屏一次算清,浏览/翻页/跳页三处共用,
   自动保持一致。
   ════════════════════════════════════════════════════════════════════════════ */

import { spreadIndexOfPage, isSoloSpread, spreadPageIndices, type Spread } from '../../spreads';
import type { EditorPage } from '../../types';
import type { Density } from '../mobile-canvas';

export type BrowseScreen = {
  /** 本屏要渲染的开页序号(密度 4 时最多两个;独页/末尾则更少)。 */
  spreadIndices: number[];
  /** 密度 1 时开页内只留这一页;2/4 为 null(整开页都显示)。 */
  onlyPage: number | null;
};

function isSolo(spreads: Spread[], pages: EditorPage[], i: number): boolean {
  return isSoloSpread(spreads[i], pages);
}

/** 一屏放几个开页:密度 1/2 各一个开页格,4 是两个竖排。 */
function spreadsPerScreen(density: Density): number {
  return density === 4 ? 2 : 1;
}

/** 把所有开页切成一屏一屏(仅密度 2/4 的开页单位用)。独页永远独占一屏。 */
function spreadScreens(spreads: Spread[], pages: EditorPage[], density: Density): number[][] {
  const per = spreadsPerScreen(density);
  const screens: number[][] = [];
  let i = 0;
  while (i < spreads.length) {
    if (isSolo(spreads, pages, i)) {
      screens.push([i]); // 封面/封底:单页独占,不与任何开页同屏
      i += 1;
      continue;
    }
    const group = [i];
    i += 1;
    while (group.length < per && i < spreads.length && !isSolo(spreads, pages, i)) {
      group.push(i);
      i += 1;
    }
    screens.push(group);
  }
  return screens;
}

/** 书里最后一页的下标。空书返回 -1。
 *  一律经 spreadPageIndices 取 —— 它同时处理普通对开与双宽跨页(#303 的判别式联合),
 *  直接读 .left/.right 会漏掉 kind==='full' 那一整页。 */
function lastPageIndex(spreads: Spread[]): number {
  let max = -1;
  for (const s of spreads) {
    for (const idx of spreadPageIndices(s)) if (idx > max) max = idx;
  }
  return max;
}

/** 开页的起始页(左→右顺序的第一页;封面这类只有右页的开页取右页;双宽页取它本身)。 */
function firstPageOfSpread(spreads: Spread[], spreadIdx: number): number {
  return spreadPageIndices(spreads[spreadIdx])[0] ?? 0;
}

/** 游标所在的开页序号;越界/找不到时回落到第一个开页。 */
function spreadOf(spreads: Spread[], pageIdx: number): number {
  const si = spreadIndexOfPage(spreads, pageIdx);
  return si < 0 ? 0 : si;
}

/** 游标所在的屏(密度 2/4);返回该屏在 screens 里的 index 与内容。 */
function screenOf(screens: number[][], targetSpread: number): { idx: number; group: number[] } {
  const idx = screens.findIndex((g) => g.includes(targetSpread));
  if (idx < 0) return { idx: 0, group: screens[0] ?? [] };
  return { idx, group: screens[idx] };
}

export function browseScreen(
  spreads: Spread[],
  pages: EditorPage[],
  startPageIdx: number,
  density: Density,
): BrowseScreen {
  if (spreads.length === 0) return { spreadIndices: [], onlyPage: null };
  if (density === 1) {
    // 密度 1 是单页单位:开页内只留游标那一页。
    return { spreadIndices: [spreadOf(spreads, startPageIdx)], onlyPage: startPageIdx };
  }
  const screens = spreadScreens(spreads, pages, density);
  const { group } = screenOf(screens, spreadOf(spreads, startPageIdx));
  return { spreadIndices: group, onlyPage: null };
}

/** 左右滑/点翻页:从当前屏往 dir 方向翻一屏,返回新的页游标。到头到尾夹住。 */
export function stepScreen(
  spreads: Spread[],
  pages: EditorPage[],
  startPageIdx: number,
  density: Density,
  dir: 1 | -1,
): number {
  if (spreads.length === 0) return 0;
  if (density === 1) {
    const last = lastPageIndex(spreads);
    return Math.max(0, Math.min(startPageIdx + dir, last));
  }
  const screens = spreadScreens(spreads, pages, density);
  const { idx } = screenOf(screens, spreadOf(spreads, startPageIdx));
  const nextIdx = Math.max(0, Math.min(idx + dir, screens.length - 1));
  return firstPageOfSpread(spreads, screens[nextIdx][0]);
}

/** 跳到某页(位置条/章节 chip)时,把游标对齐到该页所在那一屏的起点。 */
export function screenStartOfPage(
  spreads: Spread[],
  pages: EditorPage[],
  pageIdx: number,
  density: Density,
): number {
  if (spreads.length === 0) return 0;
  if (density === 1) return pageIdx;
  const screens = spreadScreens(spreads, pages, density);
  const { group } = screenOf(screens, spreadOf(spreads, pageIdx));
  return firstPageOfSpread(spreads, group[0]);
}
