/* ════════════════════════════════════════════════════════════════════════════
   image-swap —— 「长按图片拖到另一个图槽,松手交换」的纯逻辑层。桌面与移动共用。

   ── 为什么是长按,而不是直接拖 ──────────────────────────────────────────────
   图槽上的**直接拖动已经有主人了**:桌面是 dragToImagePos(在框内平移画面),
   移动端没选中时是翻页、选中后同样是平移。再把「拖出去换位置」也压到同一个手势上,
   两种意图就只能靠「拖了多远/往哪拖」去猜 —— 猜错的代价是用户以为在微调构图,
   结果两张照片对调了。所以交换要一个**明确的进入动作**:按住 350ms 把图「拾起来」。
   拾起前只要位移超过 SLOP,就判定用户本来就想平移/翻页,拾起取消。

   ── 交换只动 imagesJson,位置/缩放留在原槽 ─────────────────────────────────
   与既有「换图」同口径(page-edit.ts / EditorPort.swapImage 的注释都写着「换的是
   内容不是版面」)。理由在换位置这件事上更成立:两个槽的画幅常常不一样(竖框 ↔ 宽框),
   把 A 槽为竖框调出来的 scale=1.4 跟着照片搬进宽框,只会得到一个莫名其妙的放大。
   槽保留自己的构图,照片换过去按该槽既有的构图落座。

   存库 html **一个字不改**:图片位是 {{IMG_SRC:slot}} token,显示时按 imagesJson
   现查现解析。碰 html 反而会把 token 烘死成某张具体照片,以后换不动(与换图同理)。

   全部纯函数、零 DOM:能被 node 直接测(仓里没有 jsdom),也让移动端那棵
   「不许碰 document」的子树可以照用。
   ════════════════════════════════════════════════════════════════════════════ */

import type { EditorPage } from '../types';

/** 按住多久算「拾起」。350ms:比 iOS 长按菜单(~500ms)短,比误触阈值(~200ms)长。 */
export const SWAP_LONG_PRESS_MS = 350;
/** 桌面的拾起阈值单独放宽到 1s(2026-08-02 用户拍板):单击已经承担「弹编辑卡」,
 *  350ms 会把慢一点的点击误判成拾起;桌面没有系统长按手势要避,可以尽管加长。
 *  移动端保持 350ms —— 那边要抢在 iOS 长按菜单(~500ms)之前,不能跟着放宽。 */
export const SWAP_LONG_PRESS_DESKTOP_MS = 1000;
/** 拾起前允许的手指抖动。超过就认定是平移/翻页,不是长按。 */
export const SWAP_LONG_PRESS_SLOP = 8;
/** 移动端:拖到离画板左右边缘多少 px 以内算「想翻页」。 */
export const SWAP_EDGE_ZONE = 56;
/** 移动端:在边缘停留多久自动翻一页(连续停留则每隔这么久再翻一页)。 */
export const SWAP_EDGE_FLIP_MS = 650;

/** 一个图槽的坐标:哪一页的哪个槽。pageIndex 是 EditorPage.pageIndex,不是数组下标。 */
export type SwapSlotRef = { pageIndex: number; slotId: string };

export function sameSwapSlot(a: SwapSlotRef | null, b: SwapSlotRef | null): boolean {
  return a != null && b != null && a.pageIndex === b.pageIndex && a.slotId === b.slotId;
}

/** 拾起阶段的位移判据:超过 slop 就取消长按(用户在平移/翻页)。 */
export function exceedsLongPressSlop(
  dx: number,
  dy: number,
  slop: number = SWAP_LONG_PRESS_SLOP,
): boolean {
  return Math.abs(dx) > slop || Math.abs(dy) > slop;
}

/**
 * 移动端拖到边缘时该往哪翻页。
 *
 * @param clientX 手指的视口 x
 * @param rect    画板(.mboard)的视口矩形
 * @returns +1 下一页 / -1 上一页 / null 不在边缘区
 */
export function edgeFlipDirection(
  clientX: number,
  rect: { left: number; width: number },
  zone: number = SWAP_EDGE_ZONE,
): 1 | -1 | null {
  if (rect.width <= zone * 2) return null; // 画板太窄,整块都是「边缘」→ 不自动翻页
  if (clientX <= rect.left + zone) return -1;
  if (clientX >= rect.left + rect.width - zone) return 1;
  return null;
}

/** 交换结果:整份新的 pages(未触及的页保持对象同一性)+ 改动了哪些 pageIndex。 */
export type SwapResult = { pages: EditorPage[]; touched: number[] };

/**
 * 交换两个图槽的照片。
 *
 * 返回 null 表示这一次交换**没有意义**,调用方直接当无事发生:
 *   · 落回原槽(同一页同一个槽)
 *   · 任一页不存在
 *   · 两个槽都是空的(交换两个空框 = 什么都没发生)
 *
 * 空槽参与交换是**允许**的,而且很重要:把一张照片拖进空框 = 移动过去,原槽变空。
 * 这时被交换的那一侧要**删 key** 而不是写空串 —— 与 applyImageClear 同口径
 * (空串会在数据里留一条指向「空照片」的假记录,读侧还得再判一次)。
 */
export function swapImageSlots(
  pages: readonly EditorPage[],
  from: SwapSlotRef,
  to: SwapSlotRef,
): SwapResult | null {
  if (sameSwapSlot(from, to)) return null;
  const fromPage = pages.find((p) => p.pageIndex === from.pageIndex);
  const toPage = pages.find((p) => p.pageIndex === to.pageIndex);
  if (!fromPage || !toPage) return null;

  const fromPhoto = fromPage.imagesJson[from.slotId];
  const toPhoto = toPage.imagesJson[to.slotId];
  if (fromPhoto === undefined && toPhoto === undefined) return null;
  if (fromPhoto === toPhoto) return null; // 同一张照片,交换看不出任何变化

  const put = (images: Record<string, string>, slotId: string, photoId: string | undefined) => {
    const next = { ...images };
    if (photoId === undefined) delete next[slotId];
    else next[slotId] = photoId;
    return next;
  };

  if (from.pageIndex === to.pageIndex) {
    // 同一页:两次改动必须打在**同一份**新 record 上,分开做会互相覆盖。
    let images = put(fromPage.imagesJson, from.slotId, toPhoto);
    images = put(images, to.slotId, fromPhoto);
    const nextPage = { ...fromPage, imagesJson: images };
    return {
      pages: pages.map((p) => (p.pageIndex === from.pageIndex ? nextPage : p)),
      touched: [from.pageIndex],
    };
  }

  const nextFrom = { ...fromPage, imagesJson: put(fromPage.imagesJson, from.slotId, toPhoto) };
  const nextTo = { ...toPage, imagesJson: put(toPage.imagesJson, to.slotId, fromPhoto) };
  return {
    pages: pages.map((p) => {
      if (p.pageIndex === from.pageIndex) return nextFrom;
      if (p.pageIndex === to.pageIndex) return nextTo;
      return p;
    }),
    touched: [from.pageIndex, to.pageIndex],
  };
}
