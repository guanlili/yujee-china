/* ════════════════════════════════════════════════════════════════════════════
   browse-window —— 浏览态「这一屏显示什么」。纯函数,不碰 DOM。

   旧实现是对桌面 renderOverview 产出的格子做 display:none(mobile-canvas.ts),
   桌面每次重建 innerHTML 都会把它冲刷掉,得追着重贴。移动端有了自己的 UI 树之后,
   这件事退化成一次普通计算:输入开页表 + 页游标 + 密度,输出该渲染哪些开页。

   开页表复用桌面同一份 buildSpreads —— 封面开在右手页、封底收在左手页这类规则
   只能有一份实现,移动端另写一套迟早会和桌面漂移。
   ════════════════════════════════════════════════════════════════════════════ */

import { spreadIndexOfPage, type Spread } from '../../spreads';
import type { Density } from '../mobile-canvas';

export type BrowseScreen = {
  /** 本屏要渲染的开页序号(密度 4 时最多两个;末尾不足则短返回)。 */
  spreadIndices: number[];
  /** 密度 1 时开页内只留这一页;2/4 为 null(整开页都显示)。 */
  onlyPage: number | null;
};

/** 一屏放几个开页:密度 1/2 各一个开页格,4 是两个竖排。 */
function spreadsPerScreen(density: Density): number {
  return density === 4 ? 2 : 1;
}

/** 书里最后一页的下标(开页表推得出,不必另传总页数)。空书返回 -1。 */
function lastPageIndex(spreads: Spread[]): number {
  let max = -1;
  for (const s of spreads) {
    if (s.left != null && s.left > max) max = s.left;
    if (s.right != null && s.right > max) max = s.right;
  }
  return max;
}

/** 开页的起始页(左页优先;封面这类只有右页的开页取右页)。 */
function firstPageOfSpread(spreads: Spread[], spreadIdx: number): number {
  const s = spreads[spreadIdx];
  if (!s) return 0;
  return s.left ?? s.right ?? 0;
}

/** 游标所在的开页序号;越界/找不到时回落到第一个开页。 */
function spreadOf(spreads: Spread[], pageIdx: number): number {
  const si = spreadIndexOfPage(spreads, pageIdx);
  return si < 0 ? 0 : si;
}

export function browseScreen(
  spreads: Spread[],
  startPageIdx: number,
  density: Density,
): BrowseScreen {
  if (spreads.length === 0) return { spreadIndices: [], onlyPage: null };
  const first = spreadOf(spreads, startPageIdx);
  const indices: number[] = [];
  for (let i = first; i < first + spreadsPerScreen(density) && i < spreads.length; i++) {
    indices.push(i);
  }
  return { spreadIndices: indices, onlyPage: density === 1 ? startPageIdx : null };
}

/** 左右滑/点翻页:从当前屏往 dir 方向翻一屏,返回新的页游标。到头到尾夹住。 */
export function stepScreen(
  spreads: Spread[],
  startPageIdx: number,
  density: Density,
  dir: 1 | -1,
): number {
  if (spreads.length === 0) return 0;
  if (density === 1) {
    // 密度 1 是单页单位,逐页走。
    const last = lastPageIndex(spreads);
    return Math.max(0, Math.min(startPageIdx + dir, last));
  }
  const si = spreadOf(spreads, startPageIdx);
  const next = Math.max(0, Math.min(si + spreadsPerScreen(density) * dir, spreads.length - 1));
  return firstPageOfSpread(spreads, next);
}

/** 跳到某页(位置条/章节 chip)时,把游标对齐到该页所在那一屏的起点。 */
export function screenStartOfPage(
  spreads: Spread[],
  pageIdx: number,
  density: Density,
): number {
  if (spreads.length === 0) return 0;
  if (density === 1) return pageIdx;
  const si = spreadOf(spreads, pageIdx);
  const per = spreadsPerScreen(density);
  // 密度 4:开页两两成屏,对齐到屏起点,免得同一页因来路不同落在两种画面里。
  const aligned = Math.floor(si / per) * per;
  return firstPageOfSpread(spreads, aligned);
}
