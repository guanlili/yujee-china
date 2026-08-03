/* ════════════════════════════════════════════════════════════════════════════
   live-flip-motion —— Live 导出翻页动效的换算层(纯函数,零 DOM)。

   Live 视频里的书必须与移动端画布是**同一本书**:哪张纸、往哪转、几毫秒、什么缓动
   全部由 flip.ts 决定(live-video 直接 import);这里只补画布端自己的三件事:

     · CSS timing-function / 透视投影的数值求值 —— CSS 引擎在视频里没有,得自己算;
     · mobile-editor.css 里那些受光渐变与书影的**数值形态** —— CSS 只能声明给 DOM,
       画布要逐列采样,所以搬成 stop 数组。数值必须与 CSS 逐字一致,
       live-flip-motion.test.ts 用源文本断言锁住。

   视口换算:1080×1440 画布 = 360×480pt 手机 @3x。CSS px 一律 ×3 落到画布
   (live-video 的 CSS_DPR),透视 2400px 同样按此放大,才能与手机上看到的
   透视强度一致。
   ════════════════════════════════════════════════════════════════════════════ */

import { FLIP_EASE, type FlipDir } from '../../components/album/editor-v2/mobile/flip';

/** 与 .mboard / FlipBook stage 的 perspective 同款(CSS px)。 */
export const PERSPECTIVE = 2400;

/** 书脊沟槽宽:mspread::before 的 clamp(18px,6vw,30px) 按 360pt 视口取 6vw。 */
export const SPINE_CREASE_WIDTH = 21.6;

// ── CSS cubic-bezier 求值 ────────────────────────────────────────────────────

export function parseCubicBezier(css: string): [number, number, number, number] {
  const m = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(css);
  if (!m) throw new Error('not a cubic-bezier: ' + css);
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

/** 标准 CSS 两控制点 Bézier:牛顿迭代解 t(x),失稳时二分兜底。 */
export function cubicBezierEase(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
): (x: number) => number {
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    let ok = false;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) {
        ok = true;
        break;
      }
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    if (!ok || t < 0 || t > 1) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 32; i++) {
        t = (lo + hi) / 2;
        if (sampleX(t) < x) lo = t;
        else hi = t;
      }
    }
    return sampleY(t);
  };
}

/** 翻纸的缓动 —— 逐字取 flip.ts 的 FLIP_EASE,不重抄控制点。 */
export const flipEase = cubicBezierEase(...parseCubicBezier(FLIP_EASE));

/** medge-* 关键帧用的 var(--ease)(editor-tokens.css)。 */
export const tokenEase = cubicBezierEase(0.4, 0, 0.2, 1);

/** 动效时长 → 帧数。至少 2 帧,不然「过渡」退化成跳变。 */
export function transitionFrameCount(ms: number, fps: number): number {
  return Math.max(2, Math.round((ms / 1000) * fps));
}

// ── 透视投影 ─────────────────────────────────────────────────────────────────

/**
 * 纸片上距书脊 u 的一列,rotateY(angleDeg) 后投到屏幕:返回列的 x 与纵向缩放 k。
 *
 * side=+1:纸片 0° 时摊在书脊右侧(封面/next 的叶子);-1 = 左侧(ending)。
 * 旋转方向按 CSS rotateY 的符号:next 0→-180、prev/ending 0↔180,两条 z 都朝观众。
 * 投影即 CSS perspective 的定义:scale = p/(p-z),原点在画布中心(perspective-origin
 * 默认 50% 50%,.mboard 的中心就是书的中心)。
 */
export function projectLeafColumn(
  u: number,
  angleDeg: number,
  side: 1 | -1,
  spineX: number,
  originX: number,
  perspective: number,
): { x: number; k: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const x3 = side * u * Math.cos(rad);
  const z = -side * u * Math.sin(rad);
  const k = perspective / (perspective - z);
  return { x: originX + (spineX + x3 - originX) * k, k };
}

// ── 渐变采样(受光层)──────────────────────────────────────────────────────────

/** [r,g,b,a]:r/g/b 0–255,a 0–1。 */
export type StopColor = [number, number, number, number];
export type GradientStop = { at: number; color: StopColor };

const TRANSPARENT: StopColor = [0, 0, 0, 0];

/**
 * 按 CSS 渐变语义采样:**预乘**插值 —— transparent 停靠点只降 alpha,
 * 不会把相邻的白色拖成灰(canvas 逐列 fillRect 模拟渐变时必须自己做对这件事)。
 */
export function sampleStops(stops: GradientStop[], f: number): StopColor {
  if (f <= stops[0]!.at) return stops[0]!.color;
  const last = stops[stops.length - 1]!;
  if (f >= last.at) return last.color;
  for (let i = 1; i < stops.length; i++) {
    const b = stops[i]!;
    if (f > b.at) continue;
    const a = stops[i - 1]!;
    const t = (f - a.at) / (b.at - a.at);
    const [r1, g1, b1, a1] = a.color;
    const [r2, g2, b2, a2] = b.color;
    const alpha = a1 + (a2 - a1) * t;
    if (alpha < 1e-9) return [0, 0, 0, 0];
    // 预乘:色道先乘各自 alpha 再插值,最后除回。
    const r = (r1 * a1 + (r2 * a2 - r1 * a1) * t) / alpha;
    const g = (g1 * a1 + (g2 * a2 - g1 * a1) * t) / alpha;
    const bb = (b1 * a1 + (b2 * a2 - b1 * a1) * t) / alpha;
    return [Math.round(r), Math.round(g), Math.round(bb), alpha];
  }
  return last.color;
}

export function stopCss([r, g, b, a]: StopColor): string {
  return `rgba(${r},${g},${b},${a})`;
}

/** mleaf-face::after:正面纸边受光(书脊侧压暗 → 外口提亮)。 */
export const LEAF_FRONT_EDGE: GradientStop[] = [
  { at: 0, color: [0, 0, 0, 0.12] },
  { at: 0.26, color: TRANSPARENT },
  { at: 1, color: [255, 255, 255, 0.07] },
];

/** mleaf-back::after:背面镜像(外口微亮 → 书脊侧压暗)。 */
export const LEAF_BACK_EDGE: GradientStop[] = [
  { at: 0, color: [255, 255, 255, 0.08] },
  { at: 0.7, color: TRANSPARENT },
  { at: 1, color: [0, 0, 0, 0.15] },
];

/** mleaf-shade:翻页受光,与 flip.ts leafShading 的渐变逐字同源(f = 内容列比例)。 */
export function leafShadeStops(dir: FlipDir): GradientStop[] {
  return dir === 'next'
    ? [
        { at: 0.7, color: TRANSPARENT },
        { at: 1, color: [0, 0, 0, 0.08] },
      ]
    : [
        { at: 0, color: [0, 0, 0, 0.08] },
        { at: 0.3, color: TRANSPARENT },
      ];
}

/** mpage::before:左半页向书脊的弧面明暗。 */
export const PAGE_SPINE_LEFT: GradientStop[] = [
  { at: 0.7, color: TRANSPARENT },
  { at: 0.86, color: [255, 255, 255, 0.06] },
  { at: 1, color: [0, 0, 0, 0.14] },
];

/** mpage::before:右半页镜像。 */
export const PAGE_SPINE_RIGHT: GradientStop[] = [
  { at: 0, color: [0, 0, 0, 0.13] },
  { at: 0.14, color: [255, 255, 255, 0.07] },
  { at: 0.3, color: TRANSPARENT },
];

/** mspread[data-paper-spine]::before:书脊沟槽的折光带。 */
export const SPINE_CREASE: GradientStop[] = [
  { at: 0, color: [255, 255, 255, 0.1] },
  { at: 0.23, color: [0, 0, 0, 0.04] },
  { at: 0.46, color: [0, 0, 0, 0.16] },
  { at: 0.5, color: [0, 0, 0, 0.24] },
  { at: 0.54, color: [255, 255, 255, 0.14] },
  { at: 0.77, color: [0, 0, 0, 0.05] },
  { at: 1, color: [255, 255, 255, 0.08] },
];

/** mspread::after:1px 接缝与两侧受光/背光描边。 */
export const SPINE_SEAM = {
  color: 'rgba(16,20,19,.30)',
  lit: 'rgba(255,255,255,.13)',
  shade: 'rgba(0,0,0,.08)',
} as const;

// ── 书影与纸叠(box-shadow 的数值形态,CSS px)─────────────────────────────────

export type DropShadow = { y: number; blur: number; color: string };

/** 摊开书体(pair/full)的三层加深投影。 */
export const SPREAD_BOOK_SHADOW: DropShadow[] = [
  { y: 2, blur: 4, color: 'rgba(20,24,23,.20)' },
  { y: 14, blur: 30, color: 'rgba(20,24,23,.18)' },
  { y: 34, blur: 70, color: 'rgba(20,24,23,.16)' },
];

/** 封皮开合(medge-shadow-in 终值)= 独页封皮(.mpage)的投影。 */
export const EDGE_BOOK_SHADOW: DropShadow[] = [
  { y: 2, blur: 5, color: 'rgba(24,28,27,.18)' },
  { y: 18, blur: 42, color: 'rgba(24,28,27,.16)' },
];
export const SOLO_BOOK_SHADOW = EDGE_BOOK_SHADOW;

/** 翻动纸片自己的投影(mleaf-face)。 */
export const LEAF_SHADOW: DropShadow = { y: 12, blur: 14, color: 'rgba(20,24,23,.22)' };

/** 独页封皮的内圈描边(白圈在外、极淡黑圈略宽垫底)。 */
export const SOLO_INSET_RINGS = [
  { w: 1.5, color: 'rgba(24,28,27,.04)' },
  { w: 1, color: 'rgba(255,255,255,.32)' },
] as const;

/** 翻动纸片的 1px 内圈(mleaf-face::after 的 inset box-shadow)。 */
export const LEAF_INSET_RING = { w: 1, color: 'rgba(255,255,255,.22)' } as const;

export const PAPER_SHEET_LIT = '#fcfbf8';
export const PAPER_SHEET_SHADE = '#d9d4ca';

/** 书口纸叠:x 偏移 + 负 spread(shrink)逐层内缩,lit/shade 交替,两侧对称。 */
export const PAPER_STACK: { x: number; shrink: number; color: string }[] = [
  { x: 2, shrink: 1, color: PAPER_SHEET_LIT },
  { x: 3.5, shrink: 1.5, color: PAPER_SHEET_SHADE },
  { x: 5, shrink: 2, color: PAPER_SHEET_LIT },
  { x: 6.5, shrink: 2.5, color: PAPER_SHEET_SHADE },
  { x: 8, shrink: 3, color: PAPER_SHEET_LIT },
];

// ── 封皮开合的底层显隐时间线(medge-under-in/out 关键帧)──────────────────────

export const EDGE_UNDER_IN = { delay: 210, duration: 200 } as const;
export const EDGE_UNDER_OUT = { delay: 350, duration: 180 } as const;

/** 开卷:正文与书脊 210ms 后显现;合卷:350ms 起隐去。进度用 --ease 缓动。 */
export function edgeUnderAlpha(opening: boolean, tMs: number): number {
  const spec = opening ? EDGE_UNDER_IN : EDGE_UNDER_OUT;
  const f = Math.min(1, Math.max(0, (tMs - spec.delay) / spec.duration));
  const eased = f <= 0 ? 0 : f >= 1 ? 1 : tokenEase(f);
  return opening ? eased : 1 - eased;
}
