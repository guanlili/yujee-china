/* ════════════════════════════════════════════════════════════════════════════
   live-grid-motion —— Live 导出结尾「全部页面一览」的排布与滚动(纯函数,零 DOM)。

   翻完最后一屏之后接的那一段:三列跨页缩略图从顶滚到底,把整本书交代完。
   与录屏里点「全部页面一览」看到的是同一件事,只是视频里没人点,靠时间线自己走。

   两条不变式值得写死在这里而不是散在画布代码里:
     · 列宽由画幅反推 —— cols·cellW + (cols-1)·gap + 2·pad ≡ 画幅宽,格子恒铺满;
     · 滚动**正好**停在底 —— 最后一帧的位移严格等于 contentH - 画幅高。
       差一点就会在画面底部露出一条画幅外的空白,而那种错在成片里最难发现。
   ════════════════════════════════════════════════════════════════════════════ */

import { cubicBezierEase } from './live-flip-motion';

/** 三列;留白与列距按 1080 宽画幅取整数,缩放到别的画幅也照样铺满(列宽是反推的)。 */
const COLS = 3;
const PAD = 36;
const GAP = 24;

/** 滚动速度与两端时长兜底:太快看不清,太慢拖沓。 */
const SCROLL_PX_PER_SEC = 190;
const MIN_SCROLL_SEC = 3;
const MAX_SCROLL_SEC = 20;
/** 一屏放得下、根本不用滚时的凝视时长。**不能复用 MIN_SCROLL_SEC** ——
 *  那样短书会得到 3 秒纹丝不动的「滚动」,加上定格就是 4 秒多的静止画面,
 *  在一条十几秒的分享片里等于最后三分之一冻住。 */
const STILL_SEC = 1.2;
/** 书 → 网格的交叉淡出,与滚到底之后的定格。 */
const FADE_SEC = 0.4;
const HOLD_SEC = 1;

/** 标准 CSS ease-in-out:首尾缓、中段匀。 */
const scrollEase = cubicBezierEase(0.42, 0, 0.58, 1);

export interface GridSpec {
  cols: number;
  pad: number;
  gap: number;
  cellW: number;
  cellH: number;
  rows: number;
  /** 整张网格的高(含上下留白)。 */
  contentH: number;
  /** 需要滚过的距离;一屏放得下时为 0。 */
  scroll: number;
  /** 一屏放得下时把整张网格压到画幅正中的纵向偏移;要滚就为 0。 */
  offsetY: number;
}

export interface GridOptions {
  cols?: number;
  pad?: number;
  gap?: number;
}

/**
 * @param count     一共多少格(= 视图数,一格一个跨页)
 * @param cellRatio 单格的 宽/高(跨页比例)
 */
export function gridSpec(
  count: number,
  outW: number,
  outH: number,
  cellRatio: number,
  opts: GridOptions = {},
): GridSpec {
  const cols = opts.cols ?? COLS;
  const pad = opts.pad ?? PAD;
  const gap = opts.gap ?? GAP;
  const cellW = (outW - pad * 2 - gap * (cols - 1)) / cols;
  const cellH = cellW / cellRatio;
  const rows = Math.max(1, Math.ceil(Math.max(0, count) / cols));
  const contentH = pad * 2 + rows * cellH + (rows - 1) * gap;
  const scroll = Math.max(0, contentH - outH);
  // 一屏放得下就居中。顶对齐会让画幅下半截空成一片背景 —— 真片取证里就是这样,
  // 看着像渲染坏了。要滚的书不能居中,否则滚动起点错位。
  const offsetY = scroll > 0 ? 0 : (outH - contentH) / 2;
  return { cols, pad, gap, cellW, cellH, rows, contentH, scroll, offsetY };
}

/** 第 i 格在画幅坐标系里的矩形(行优先;画的时候再减去滚动位移)。 */
export function gridCellRect(i: number, s: GridSpec): { x: number; y: number; w: number; h: number } {
  const r = Math.floor(i / s.cols);
  const c = i - r * s.cols;
  return {
    x: s.pad + c * (s.cellW + s.gap),
    y: s.offsetY + s.pad + r * (s.cellH + s.gap),
    w: s.cellW,
    h: s.cellH,
  };
}

/** 滚完这段距离要几帧。要滚的书有上下限;不用滚的书只凝视一下就走。 */
export function gridScrollFrames(scroll: number, fps: number): number {
  if (scroll <= 0) return Math.max(2, Math.round(STILL_SEC * fps));
  const secs = Math.min(MAX_SCROLL_SEC, Math.max(MIN_SCROLL_SEC, scroll / SCROLL_PX_PER_SEC));
  return Math.max(2, Math.round(secs * fps));
}

export interface GridTail {
  /** 书 → 网格 的交叉淡出。 */
  fade: number;
  /** 滚动(或不用滚时的凝视)。 */
  scroll: number;
  /** 落底后的定格。 */
  hold: number;
  /** 三段之和。进度条的总帧数必须用它,不能在调用方再加一遍。 */
  total: number;
}

/**
 * 结尾整段的帧账。**唯一真相** —— 调用方按 fade/scroll/hold 发帧、按 total 报进度,
 * 谁改了段数只要改这里,进度条就不会走到 100% 之后还在渲。
 */
export function gridTailFrames(scroll: number, fps: number): GridTail {
  const fade = Math.max(1, Math.round(FADE_SEC * fps));
  const scrollFrames = gridScrollFrames(scroll, fps);
  const hold = Math.max(1, Math.round(HOLD_SEC * fps));
  return { fade, scroll: scrollFrames, hold, total: fade + scrollFrames + hold };
}

/** 第 f 帧(0 起)的滚动位移。f=0 在顶,f=frames-1 严格落底。 */
export function gridScrollY(f: number, frames: number, scroll: number): number {
  if (scroll <= 0 || frames <= 1) return 0;
  const x = Math.min(1, Math.max(0, f / (frames - 1)));
  return scroll * scrollEase(x);
}
