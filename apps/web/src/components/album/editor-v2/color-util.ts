/* ════════════════════════════════════════════════════════════════════════════
   color-util —— 取色器的颜色换算。桌面树与移动树共用同一份。

   原本是 EditorPort.tsx 里的模块私有函数。移动端也要一个完整取色器,但从那个 4700 行
   的桌面组件 import 会把整棵桌面树打进移动端 bundle,而复制一份又会在两边悄悄漂移
   (取色算错是「颜色对不上」这类最难查的 bug)。所以原样抽到这里,两边都从这里取。

   纯函数、零 DOM:能被 node 直接测。
   ════════════════════════════════════════════════════════════════════════════ */

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export function hsvToRgb(h: number, s: number, v: number): Rgb {
  h = ((h % 360) + 360) % 360;
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = 60 * (((((g - b) / d) % 6) + 6) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex(n: number): string {
  return Math.round(n).toString(16).padStart(2, '0');
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** HSV → #rrggbb 的一步到位(取色面板每次拖动都要它)。 */
export function hsvToHex(h: number, s: number, v: number): string {
  const { r, g, b } = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

/** 任意 CSS 颜色串(#rrggbb / rgb() / rgba())→ HSV + alpha。认不出返回 null。
 *  取色面板打开时要用它把「当前颜色」还原成三个滑杆的位置。 */
export function parseColor(value: string | null | undefined): { hsv: Hsv; alpha: number } | null {
  if (!value) return null;
  const v = value.trim();
  const hex = hexToRgb(v);
  if (hex) return { hsv: rgbToHsv(hex.r, hex.g, hex.b), alpha: 1 };
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(v);
  if (!m) return null;
  const r = Number(m[1]),
    g = Number(m[2]),
    b = Number(m[3]);
  const alpha = m[4] === undefined ? 1 : clamp01(Number(m[4]));
  return { hsv: rgbToHsv(r, g, b), alpha };
}

/** 面板输出:alpha=1 给 #rrggbb(存库 html 里更短更稳),否则给 rgba()。 */
export function toCssColor(hsv: Hsv, alpha: number): string {
  const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
  return alpha >= 1 ? rgbToHex(r, g, b) : `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 100) / 100})`;
}
