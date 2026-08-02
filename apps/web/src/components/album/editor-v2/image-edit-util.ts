// Pure geometry for the #168 manual image editor (in-frame pan + zoom). Split out
// from EditorPort.tsx so the clamp/drag math is unit-testable without importing
// the React/template/CSS tree.
//
// ── Render model (templates/web-utils.tsx WebImage) — #168 ──
// Each editable image is an <img> that FILLS a fixed-size wrapper <div> 100%×100%:
//   wrapper <div>: the slot geometry (position/top/left/width/height) + overflow:hidden
//   inner <img>:   width/height 100%, object-fit: cover, plus:
//     object-position: `${x}% ${y}%`
//     transform:       `scale(${scale})` with transform-origin `${x}% ${y}%`
// The wrapper is the frame the user sees; it never moves. scale grows the <img>
// INSIDE that frame and the wrapper's overflow:hidden CLIPS the overflow — so a
// zoom can never enlarge the slot or shove neighboring content (the #168 bug was
// scale on a bare <img> that *was* the slot, with no clip container around it).
//
// ── Why x,y∈[0,100] + scale≥1 guarantees NO WHITE EDGE + NO OVERFLOW ──
// `object-fit: cover` scales the image to the SMALLEST size that fully covers the
// box, so at scale=1 the box is already completely filled; whichever axis the
// image overflows on, `object-position` (a percentage) only slides the image
// WITHIN that overflow — 0% pins one edge, 100% the other, and every value in
// between keeps the box covered. CSS itself clamps the slide to the overflow, so
// any x,y in [0,100] is white-edge-free by construction. On the non-overflowing
// axis object-position has no visible effect (there's no slack), which is fine.
//
// `transform: scale(s)` with s≥1 only ever makes the (already-covering) image
// LARGER than the box, so it stays fully covered (no white edge); the matching
// transform-origin keeps the focal point under the cursor, and the wrapper's
// overflow:hidden trims everything past the frame (no overflow onto neighbors).
// The only way to expose white is s<1 (image smaller than the box), so the single
// hard invariant is scale≥1.
//
// Therefore the clamp is just: x,y → [0,100], scale → [SCALE_MIN, SCALE_MAX].
// (Matches the #165 contract ImagePos: x/y∈[0,100], scale∈[1,2].)

export const SCALE_MIN = 1;
export const SCALE_MAX = 2;

export interface ImagePosValue {
  x: number;
  y: number;
  scale: number;
  /** 顺时针旋转,只允许 90 的倍数;0 不落库(缺省即 0)。渲染用「盒交换」:90/270
   *  时 <img> 尺寸换成图框转置尺寸再 rotate,cover 白边不变式照旧成立。 */
  rotate?: number;
}

export const DEFAULT_IMAGE_POS: ImagePosValue = { x: 50, y: 50, scale: 1 };

/** 归一化 rotate:吸附到 90 的倍数、折进 [0,360),0 归一为 undefined(不落库)。 */
export function normalizeRotate(rotate: number | undefined): 90 | 180 | 270 | undefined {
  if (!rotate || Number.isNaN(rotate)) return undefined;
  const snapped = ((Math.round(rotate / 90) * 90) % 360 + 360) % 360;
  return snapped === 0 ? undefined : (snapped as 90 | 180 | 270);
}

/** 顺时针转一步(编辑卡「旋转」按钮):0→90→180→270→0。 */
export function rotateImagePos(current: ImagePosValue): ImagePosValue {
  return clampImagePos({ ...current, rotate: ((current.rotate ?? 0) + 90) % 360 });
}

/** 屏幕位移 → 图像轴位移(预览拖动的旋转补偿):image = R(-θ)·screen。
 *  没有旋转时原样返回,拖动手感与 2026-08-02 之前逐像素一致。 */
export function rotateDragDelta(
  rotate: number | undefined,
  dxPx: number,
  dyPx: number,
): { dx: number; dy: number } {
  switch (normalizeRotate(rotate)) {
    case 90:
      return { dx: dyPx, dy: -dxPx };
    case 180:
      return { dx: -dxPx, dy: -dyPx };
    case 270:
      return { dx: -dyPx, dy: dxPx };
    default:
      return { dx: dxPx, dy: dyPx };
  }
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

// Round to 1 decimal: object-position % at sub-pixel precision is meaningless and
// keeps the persisted JSON small / stable across saves.
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Clamp a candidate position into the contract-legal, white-edge-free range.
// scale is rounded to 2 decimals (slider/wheel step granularity); x,y to 1.
export function clampImagePos(pos: ImagePosValue): ImagePosValue {
  const rotate = normalizeRotate(pos.rotate);
  return {
    x: round1(clamp(pos.x, 0, 100)),
    y: round1(clamp(pos.y, 0, 100)),
    scale: Math.round(clamp(pos.scale, SCALE_MIN, SCALE_MAX) * 100) / 100,
    ...(rotate ? { rotate } : {}),
  };
}

// Map a pointer drag (screen-space px delta over the on-screen <img> box) to a new
// object-position. Dragging the image RIGHT (dx>0) should reveal more of its LEFT
// side, i.e. DECREASE object-position x — so the delta is subtracted. A full
// box-width drag sweeps the entire 0–100 range (1:1 with the visible overflow at
// scale=1; at higher scale the larger overflow makes the same drag move less of
// the subject, which feels natural). boxW/boxH are the rendered (post-zoom) px
// size of the <img>, so the mapping is automatically independent of canvas zoom.
export function dragToImagePos(
  start: ImagePosValue,
  dxPx: number,
  dyPx: number,
  boxW: number,
  boxH: number,
): ImagePosValue {
  const dxPct = boxW > 0 ? (dxPx / boxW) * 100 : 0;
  const dyPct = boxH > 0 ? (dyPx / boxH) * 100 : 0;
  return clampImagePos({
    x: start.x - dxPct,
    y: start.y - dyPct,
    scale: start.scale,
  });
}

// Apply a zoom delta (wheel/slider/buttons) around the current focal point,
// keeping x,y (the transform-origin) put. Clamped to [SCALE_MIN, SCALE_MAX].
export function zoomImagePos(current: ImagePosValue, deltaScale: number): ImagePosValue {
  return clampImagePos({ ...current, scale: current.scale + deltaScale });
}

// ── 弹窗预览几何(2026-08-02 设计,docs/specs/2026-08-02-image-edit-popup-
// preview-design.md):编辑弹窗里整图 contain 展示,当前可见裁切窗口亮框标出,
// 在预览内拖动图片调 object-position。画布上的照片拖拽调位交互已删除 ——
// 时间维度(8px/350ms)切分不了「微调中的停顿」和「长按拾起」,位置调整整体
// 搬进弹窗,画布长按专职交换。

/** 可见裁切窗口,**原图归一化坐标**(0..1)。 */
export type CropFraction = { left: number; top: number; width: number; height: number };

/**
 * cover-fit + object-position + scale 下,图框实际显示了原图的哪一块。
 * k0 = max(frameW/natW, frameH/natH),k = k0*scale;可见比例 fx = frameW/(natW*k);
 * object-position 的 x% 语义是「图的 x% 点对齐框的 x% 点」→ left = x/100*(1-fx)。
 * 任一尺寸非法(0/负/NaN)→ null,绝不产出 NaN 几何。
 */
export function coverCropFraction(
  natW: number,
  natH: number,
  frameW: number,
  frameH: number,
  pos: ImagePosValue,
): CropFraction | null {
  if (!(natW > 0) || !(natH > 0) || !(frameW > 0) || !(frameH > 0)) return null;
  const k = Math.max(frameW / natW, frameH / natH) * Math.max(pos.scale, SCALE_MIN);
  const fx = Math.min(1, frameW / (natW * k));
  const fy = Math.min(1, frameH / (natH * k));
  return {
    left: (pos.x / 100) * (1 - fx),
    top: (pos.y / 100) * (1 - fy),
    width: fx,
    height: fy,
  };
}

/**
 * 预览内拖动 → 新 ImagePos。方向语义与画布时代的 dragToImagePos 一致:把图往右
 * 拖(dx>0)= 露出图的左侧 = x 减小。预览里整图宽 previewW px,水平可滑余量 =
 * previewW*(1-crop.width) px,拖满余量恰好扫完 0..100。满幅轴(可见比例=1,
 * 无余量)忽略该轴的拖动 —— 除法分母为 0 的情形在语义上就是「没得滑」。
 */
export function previewDragToImagePos(
  start: ImagePosValue,
  dxPx: number,
  dyPx: number,
  previewW: number,
  previewH: number,
  crop: CropFraction,
): ImagePosValue {
  const slackX = previewW * (1 - crop.width);
  const slackY = previewH * (1 - crop.height);
  return clampImagePos({
    x: slackX > 0 ? start.x - (dxPx / slackX) * 100 : start.x,
    y: slackY > 0 ? start.y - (dyPx / slackY) * 100 : start.y,
    scale: start.scale,
  });
}
