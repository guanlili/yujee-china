/* ════════════════════════════════════════════════════════════════════════════
   flip —— 翻纸动效的「哪张纸、往哪转、三层各画谁」。

   效果源头是 FlipBook.tsx 的 3D page-turn(产品既有,不自创):一张半宽/整宽的纸片
   绕书脊那条边 rotateY 180°,正面是翻走的那页、背面是翻进来的那页,底下垫着目标屏。
   时长与缓动逐字取自那边。

   全部纯函数、零 DOM:能被 node 直接测(仓里没有 jsdom)。
   ════════════════════════════════════════════════════════════════════════════ */

/** 与 FlipBook 的 FLIP_MS 一致(它对齐 editor.html 的 .flipper transition)。 */
export const FLIP_MS = 900;
/** 与 FlipBook 的纸片 transition 一致。 */
export const FLIP_EASE = 'cubic-bezier(.45,.05,.2,1)';
/** 收尾定格的余量(同 FlipBook:FLIP_MS + 40)。 */
export const FLIP_SETTLE_MS = 40;

export type FlipDir = 'next' | 'prev';

/** 一屏的形状:摆了几个开页(rows)、每个开页摆了几页(halves)。 */
export type ScreenShape = { rows: number; halves: number };

/**
 * 这一步能不能做翻纸动效。
 *
 * 不能的三种情形,一律直接切屏(与 FlipBook 对 solo 边界的处置同一理由:
 * 跨宽度的纸片会撕裂/错位,宁可硬切也不要残影和闪白):
 *   · 用户要求减弱动效(prefers-reduced-motion)
 *   · 一屏摆了多个开页(密度 4)—— 没有单一的「那张纸」可翻
 *   · 前后两屏几何不同(独页↔对开)—— 纸片宽度会变
 */
export function canFlip(from: ScreenShape, to: ScreenShape, reducedMotion: boolean): boolean {
  if (reducedMotion) return false;
  if (from.rows !== 1 || to.rows !== 1) return false;
  if (from.halves !== to.halves) return false;
  return from.halves === 1 || from.halves === 2;
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

/** 纸片正面的翻页受光:靠书脊那侧压暗一点。取自 FlipBook 的 page-turn shading。 */
export function leafShading(dir: FlipDir): string {
  return dir === 'next'
    ? 'linear-gradient(90deg, transparent 70%, rgba(0,0,0,.08))'
    : 'linear-gradient(90deg, rgba(0,0,0,.08), transparent 30%)';
}
