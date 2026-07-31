/* ════════════════════════════════════════════════════════════════════════════
   flip —— 翻纸动效的「哪张纸、往哪转、三层各画谁」。

   效果源头是 FlipBook.tsx 的 3D page-turn(产品既有,不自创):一张半宽/整宽的纸片
   绕书脊那条边 rotateY 180°,正面是翻走的那页、背面是翻进来的那页,底下垫着目标屏。
   时长与缓动逐字取自那边。

   全部纯函数、零 DOM:能被 node 直接测(仓里没有 jsdom)。
   ════════════════════════════════════════════════════════════════════════════ */

import { shouldDirectSwitch } from '../../spreads';

/** 与 FlipBook 的 FLIP_MS 一致(它对齐 editor.html 的 .flipper transition)。 */
export const FLIP_MS = 900;
/** 与 FlipBook 的纸片 transition 一致。 */
export const FLIP_EASE = 'cubic-bezier(.45,.05,.2,1)';
/** 收尾定格的余量(同 FlipBook:FLIP_MS + 40)。 */
export const FLIP_SETTLE_MS = 40;

export type FlipDir = 'next' | 'prev';
export type SoloRole = 'cover' | 'ending' | null;
export type FlipTransition = 'spread' | 'cover-open' | 'ending-open';

/** 一屏的形状。solo/full 与桌面同一套分类(spreadRenderKind)。 */
export type ScreenShape = {
  /** 一屏摆了几个开页(密度 4 是两个)。 */
  rows: number;
  /** 那个开页摆了几张面(pair=2,solo/full=1)。 */
  faces: number;
  /** 封面/封尾单页的明确角色；特殊边缘翻页靠它决定方向。 */
  soloRole: SoloRole;
  /** 双宽跨页(#303)—— 一整张连续面,没有可翻的半页。 */
  full: boolean;
};

/**
 * 这一步能不能做翻纸动效。
 *
 * 与桌面共用的那三条理由(减弱动效 / 任一端是单页 solo / 任一端是双宽 full)
 * **一律走 spreads.ts 的 shouldDirectSwitch**,不在这里重写 —— 那条判断在 #303 被
 * 专门抽成纯函数并单测过(原先写成一整条布尔表达式时 `&&` 钻进 `||` 链里漏判过),
 * 移动端再抄一遍就等于又造一个会漂移的第二真相。
 *
 * 这里只加移动端独有的两条:
 *   · 一屏摆了多个开页(密度 4)—— 没有单一的「那张纸」可翻
 *   · 前后两屏摆的面数不同 —— 纸片宽度会变,跨宽度会撕裂
 */
export function flipTransition(
  from: ScreenShape,
  to: ScreenShape,
  dir: FlipDir,
  reducedMotion: boolean,
): FlipTransition | null {
  if (from.rows !== 1 || to.rows !== 1) return null;
  if (shouldDirectSwitch(reducedMotion, false, false, from.full, to.full)) return null;

  const fromRole = from.soloRole;
  const toRole = to.soloRole;

  if (
    fromRole === 'cover' &&
    toRole === null &&
    to.faces === 2 &&
    dir === 'next'
  ) {
    return 'cover-open';
  }
  if (
    fromRole === 'ending' &&
    toRole === null &&
    to.faces === 2 &&
    dir === 'prev'
  ) {
    return 'ending-open';
  }

  const sourceSolo = fromRole !== null;
  const targetSolo = toRole !== null;
  if (shouldDirectSwitch(false, sourceSolo, targetSolo, false, false)) return null;
  if (from.faces !== to.faces) return null;
  return from.faces === 1 || from.faces === 2 ? 'spread' : null;
}

/** 纸片的几何:贴在哪半边、多宽、绕哪条边转、转到多少度。 */
export type LeafGeometry = {
  /** 纸片左边缘占开页宽度的比例(0 = 贴左,0.5 = 从书脊起)。 */
  leftFrac: number;
  /** 纸片宽度占开页宽度的比例。 */
  widthFrac: number;
  /** transform-origin:绕书脊那条边转。 */
  origin: 'left center' | 'right center';
  /** 终止角度(deg)。起始一律 0。 */
  endAngle: number;
};

export function leafGeometry(dir: FlipDir, halves: number): LeafGeometry {
  // 对开:翻下一页 = 右半页绕书脊(中线)往左扫,落到左半边。
  // 翻上一页是镜像。几何逐条对齐 FlipBook 的 turning leaf。
  if (halves === 2) {
    return dir === 'next'
      ? { leftFrac: 0.5, widthFrac: 0.5, origin: 'left center', endAngle: -180 }
      : { leftFrac: 0, widthFrac: 0.5, origin: 'right center', endAngle: 180 };
  }
  // 单页(密度 1):整页就是那张纸,书脊落在它自己那条边上。
  return dir === 'next'
    ? { leftFrac: 0, widthFrac: 1, origin: 'left center', endAngle: -180 }
    : { leftFrac: 0, widthFrac: 1, origin: 'right center', endAngle: 180 };
}

/** 居中独页占双页书盒的一半；封面左翻、封尾右翻。 */
export function centeredSoloGeometry(
  transition: Exclude<FlipTransition, 'spread'>,
): LeafGeometry {
  return transition === 'cover-open'
    ? { leftFrac: 0.25, widthFrac: 0.5, origin: 'left center', endAngle: -180 }
    : { leftFrac: 0.25, widthFrac: 0.5, origin: 'right center', endAngle: 180 };
}

/** 翻纸过程中三层各画哪一页(页数组下标;null = 那半边空着)。 */
export type LeafLayers = {
  /** 垫在底下的那一屏(纸片转过 90° 后露出来的就是它)。 */
  under: (number | null)[];
  /** 纸片正面 = 正在翻走的那页。 */
  front: number | null;
  /** 纸片背面 = 正在翻进来的那页。 */
  back: number | null;
};

/**
 * 对开(halves=2)翻下一页:
 *   底层左 = 原左页(没动),底层右 = 目标右页(纸片翻过去后露出来)
 *   纸片正面 = 原右页(翻走),背面 = 目标左页(翻进来,落在左半边)
 * 翻上一页是镜像。单页(halves=1)只有一张纸:正面原页、背面目标页、底层目标页。
 */
export function leafLayers(
  dir: FlipDir,
  halves: number,
  from: (number | null)[],
  to: (number | null)[],
): LeafLayers {
  if (halves === 2) {
    return dir === 'next'
      ? { under: [from[0] ?? null, to[1] ?? null], front: from[1] ?? null, back: to[0] ?? null }
      : { under: [to[0] ?? null, from[1] ?? null], front: from[0] ?? null, back: to[1] ?? null };
  }
  return { under: [to[0] ?? null], front: from[0] ?? null, back: to[0] ?? null };
}

/** 独页翻开时正文跨页完整垫底，独页只作为纸片正面。 */
export function centeredSoloLayers(
  from: (number | null)[],
  to: (number | null)[],
): LeafLayers {
  return { under: to, front: from[0] ?? null, back: null };
}

/** 纸片正面的翻页受光:靠书脊那侧压暗一点。取自 FlipBook 的 page-turn shading。 */
export function leafShading(dir: FlipDir): string {
  return dir === 'next'
    ? 'linear-gradient(90deg, transparent 70%, rgba(0,0,0,.08))'
    : 'linear-gradient(90deg, rgba(0,0,0,.08), transparent 30%)';
}
