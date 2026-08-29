// WCAG 相对亮度/对比度。全仓唯一实现 —— 此前 third-set-palette.test.ts 和
// cover-recap.test.ts 各抄了一份，运行时校验（set_text_colors）需要第三份，抽出来一处。
import { THIRD_SET_INK } from './third-set-palette';

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** #RGB / #RRGGBB → 相对亮度。非法输入返回 NaN，由调用方判定。 */
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return Number.NaN;
  return (
    0.2126 * channel(parseInt(full.slice(0, 2), 16)) +
    0.7152 * channel(parseInt(full.slice(2, 4), 16)) +
    0.0722 * channel(parseInt(full.slice(4, 6), 16))
  );
}

/** 两色对比度（1~21）。与参数顺序无关。任一色非法返回 NaN。 */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  if (Number.isNaN(la) || Number.isNaN(lb)) return Number.NaN;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA 正文门槛 4.5:1。非法色返回 false（拒绝比放行安全）。 */
export function meetsAA(a: string, b: string): boolean {
  const ratio = contrastRatio(a, b);
  return Number.isFinite(ratio) && ratio >= 4.5;
}

/**
 * 按两色字规则给底色选字色：深底浅字、浅底深字。
 * 不按底色逐个派生字色 —— 那样一本书看着像五本书拼的（小雨拍板 2026-08-28）。
 */
export function bestInkFor(bg: string): string {
  return contrastRatio(bg, THIRD_SET_INK.light) >= contrastRatio(bg, THIRD_SET_INK.dark)
    ? THIRD_SET_INK.light
    : THIRD_SET_INK.dark;
}
