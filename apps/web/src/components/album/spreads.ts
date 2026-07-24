import { getTemplate } from '@yujee/contracts/templates';
import { placePages } from './page-layout';
import type { EditorPage } from './types';

// Canvas model (docs/agent/template-redesign.md §4): every page lives on one
// canvas, but the head and tail each hold a solo single-page slot. cover pages
// and ending pages sit alone (outside the spread-pairing system); interior pages
// (toc + body) pair two-up. An odd trailing interior page gets a blank facing
// half. A spread holds array indices into `pages` (null = a blank half).
//
// 配对走查本身住在 page-layout.ts(唯一真相),这里只负责把它转成 Spread 形状。

// #303 复盘:双宽页最初是作为可选字段 `full?` 挂在同一个对象上的,于是「忘记读它」
// 不是编译错误 —— 五个渲染面(翻书/画板总览/拼图/Live 视频/焦点页)全部静默把跨页
// 降级成一个空白跨页,而绿的测试一个都没看见。故这里改成**带判别式的联合类型**:
// 不先窄化就读 `.left` 是类型错误,任何新消费者都被编译器逼着处理 'full' 分支。
export type Spread =
  | { kind: 'pair'; left: number | null; right: number | null }
  | { kind: 'full'; page: number };

/** 双宽页占满整个跨页时返回它的页数组下标;普通跨页返回 null。 */
export function spreadFullPage(spread: Spread | undefined): number | null {
  return spread?.kind === 'full' ? spread.page : null;
}

/**
 * 这个跨页实际占了哪些页(数组下标),按左→右顺序;空半页不计。
 * full 跨页返回单个下标 —— 它是**一张**双宽面,不是左右两半。
 */
export function spreadPageIndices(spread: Spread | undefined): number[] {
  if (!spread) return [];
  if (spread.kind === 'full') return [spread.page];
  return [spread.left, spread.right].filter((i): i is number => i !== null);
}

// cover / ending sit as solo pages; everything else (toc + interior body) pairs
// two-up. We collapse the category to that solo-vs-paired distinction here.
// Exported so the editor can label a spread by what it holds (封面/封底/内页)。
export function pageSlot(page: EditorPage): 'cover' | 'interior' | 'ending' {
  const category = getTemplate(page.templateId)?.category;
  if (category === 'cover') return 'cover';
  if (category === 'ending') return 'ending';
  return 'interior';
}

export function buildSpreads(pages: EditorPage[]): Spread[] {
  const placements = placePages(pages.map((p) => p.templateId));
  const spreads: Spread[] = [];
  placements.forEach((placement, pageArrayIndex) => {
    while (spreads.length <= placement.spreadIndex) {
      spreads.push({ kind: 'pair', left: null, right: null });
    }
    if (placement.side === 'both') {
      spreads[placement.spreadIndex] = { kind: 'full', page: pageArrayIndex };
      return;
    }
    const spread = spreads[placement.spreadIndex]!;
    // placePages 保证 'both' 独占一个 spreadIndex,故这里必是 pair。这个不变式一旦
    // 被打破,静默 return 会在没有任何测试/告警的情况下把这一页从书里丢掉 ——
    // 对相册来说,丢页是最差的失败模式,宁可炸掉也不要悄悄漏页。
    if (spread.kind !== 'pair') {
      throw new Error(
        `buildSpreads: page ${pageArrayIndex} expected spread #${placement.spreadIndex} to be 'pair' but found '${spread.kind}' — placePages invariant broken (a 'full' spread must own its spreadIndex exclusively); refusing to silently drop this page`,
      );
    }
    if (placement.side === 'left') spread.left = pageArrayIndex;
    else spread.right = pageArrayIndex;
  });
  return spreads;
}

// Which spread (index) holds a given page array index; -1 if not found.
export function spreadIndexOfPage(spreads: Spread[], pageArrayIndex: number): number {
  return spreads.findIndex((s) =>
    s.kind === 'full'
      ? s.page === pageArrayIndex
      : s.left === pageArrayIndex || s.right === pageArrayIndex,
  );
}

// A *solo* spread is a true single-page leaf: a cover (recto) or an ending
// (verso) that buildSpreads pushed on its own, with the facing half blank.
// The preview renders these as one centered page — no blank facing half, no
// center spine.
//
// IMPORTANT: an interior odd-trailing page also lands as { left: i, right: null }
// (same shape as an ending), but it is NOT solo — that blank half is normal
// spread whitespace and must stay. So we never key off "a null half"; we key off
// the *category* of the single occupied page. Only category cover/ending qualify.
export function isSoloSpread(spread: Spread | undefined, pages: EditorPage[]): boolean {
  if (!spread) return false;
  // 双宽页占满整个跨页,不是「单页 leaf」—— 它要保持双页宽的容器。
  if (spread.kind === 'full') return false;
  const hasLeft = spread.left != null;
  const hasRight = spread.right != null;
  // Exactly one half occupied — a paired interior spread is never solo.
  if (hasLeft === hasRight) return false;
  const idx = hasLeft ? spread.left! : spread.right!;
  const page = pages[idx];
  if (!page) return false;
  const slot = pageSlot(page);
  return slot === 'cover' || slot === 'ending';
}

// 一个跨页该怎么画,三选一 —— 翻书 / 画板 / 拼图 / Live 视频共用同一套分类:
//  'solo' 封面/封尾:单页宽容器,一张面居中,无空白对面半页、无中缝。
//  'full' 双宽(#303):双页宽容器,**一张**双宽面铺满,无中缝(画面本就连续)。
//  'pair' 普通内页:双页宽容器,左右各一半(null = 空白半页),中间一条中缝。
// 顺序要紧:full 先判 —— isSoloSpread 对 full 恒 false,但把两者并列写容易漏。
export type SpreadRenderKind = 'solo' | 'full' | 'pair';
export function spreadRenderKind(spread: Spread | undefined, pages: EditorPage[]): SpreadRenderKind {
  if (spread?.kind === 'full') return 'full';
  return isSoloSpread(spread, pages) ? 'solo' : 'pair';
}

// goToSpread(FlipBook.tsx)是否跳过叶子翻页动画,直接切换到目标跨页。五个原因
// 互相独立、OR 连接:偏好减少动效,或起点/终点任一端是单页 solo(封面/封尾 ——
// 容器宽度跟普通跨页不同,半宽叶子飞过宽度变化的跨页会撕裂/错位),或起点/终点
// 任一端是双宽 full(一整张连续面,没有可翻的半页)。
//
// review 加固(#303):这条判断原先是写在 FlipBook.tsx 里的一整条布尔表达式,靠
// 源文本正则 pin 住 —— 正则只能确认五个词都出现,盯不住连接它们的运算符。`&&`
// 会不声不响地钻进 `||` 链里(`&&` 比 `||` 优先级高),把"单页封面 → 普通跨页"
// 这类组合悄悄漏判成要走叶子翻页。抽成纯函数后用真实布尔输入直接单测,运算符
// 错了输入输出就对不上,不存在"正则照样通过"的空子(见 spreads.test.ts)。
export function shouldDirectSwitch(
  reducedMotion: boolean,
  soloSource: boolean,
  soloTarget: boolean,
  fullSource: boolean,
  fullTarget: boolean,
): boolean {
  return reducedMotion || soloSource || soloTarget || fullSource || fullTarget;
}
