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
}

export const DEFAULT_IMAGE_POS: ImagePosValue = { x: 50, y: 50, scale: 1 };

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
  return {
    x: round1(clamp(pos.x, 0, 100)),
    y: round1(clamp(pos.y, 0, 100)),
    scale: Math.round(clamp(pos.scale, SCALE_MIN, SCALE_MAX) * 100) / 100,
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
