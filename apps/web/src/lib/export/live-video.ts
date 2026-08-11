import type { AdaptablePage, ResolveImage } from '@/components/album/adapt-layout';
import { pageFolioInfos } from '@/components/album/page-html-dom';
import { buildSpreads, pageSlot, spreadFullPage, spreadPageIndices, spreadRenderKind, type Spread } from '@/components/album/spreads';
import type { EditorPage } from '@/components/album/types';
import { PAGE } from '@/components/album/templates/constants';
import {
  EDGE_FLIP_MS,
  FLIP_MS,
  edgeLayers,
  edgeMotion,
  flipTransition,
  leafGeometry,
  leafLayers,
  type FlipDir,
  type FlipTransition,
  type ScreenShape,
} from '@/components/album/editor-v2/mobile/flip';
import { loadAlbumFonts } from '@/lib/font/album-font-loader';
import { renderFaceToCanvas } from '@/lib/pdf/render-raster';
import { presetImageUrl, type BoardBackground } from '@/lib/board-bg/presets';
import { photoStore } from '@/lib/photo/store';
import {
  EDGE_BOOK_SHADOW,
  LEAF_BACK_EDGE,
  LEAF_FRONT_EDGE,
  LEAF_INSET_RING,
  LEAF_SHADOW,
  PAGE_SPINE_LEFT,
  PAGE_SPINE_RIGHT,
  PAPER_STACK,
  PERSPECTIVE,
  SOLO_BOOK_SHADOW,
  SOLO_INSET_RINGS,
  SPINE_CREASE,
  SPINE_CREASE_WIDTH,
  SPINE_SEAM,
  SPREAD_BOOK_SHADOW,
  edgeUnderAlpha,
  flipEase,
  leafShadeStops,
  projectLeafColumn,
  sampleStops,
  stopCss,
  tokenEase,
  transitionFrameCount,
  type DropShadow,
} from './live-flip-motion';
import { LIVE_FAN_SHAPE, fanCards, fanFaceIndex } from './live-fan-geometry';
import { gridCellRect, gridScrollY, gridSpec, gridTailFrames, type GridSpec } from './live-grid-motion';

// 上传的垫底背景只存本地(photoStore):blob → 同源 objectURL → 载入(不污染导出画布)。缺失→null→中性底。
async function loadBoardUpload(key: string, load: (src: string) => Promise<HTMLImageElement>): Promise<HTMLImageElement | null> {
  const blob = await photoStore.getBlob(key).catch(() => undefined);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  try { return await load(url); } catch { return null; } finally { URL.revokeObjectURL(url); }
}

// Live·MP4 导出:从封面开始翻到页尾,整本书浮在垫底背景上,输出 3:4 竖版 MP4(1080×1440)。
//
// 翻页动效与移动端画布是**同一本书**:哪两屏能翻、封面怎么开、封底怎么合、时长缓动,
// 全部走 flip.ts 的纯函数(flipTransition/leafGeometry/edgeMotion/…),不在这里重写第二份;
// 受光渐变、书口纸叠、书脊沟槽、书体投影按 mobile-editor.css 的数值经 live-flip-motion
// 落到画布(叶片是真·透视投影,逐列切片,不是从前那种 cos 挤压的假 3D)。
//
// 渲染全在前端:每个 face 复用 renderFaceToCanvas,逐帧合成 → WebCodecs VideoEncoder
// (H.264)→ mp4-muxer 封成 MP4。不支持 WebCodecs 的浏览器(如 Firefox)抛
// LiveUnsupportedError,由调用方友好提示。

export class LiveUnsupportedError extends Error {
  constructor() {
    super('WebCodecs H.264 not supported in this browser');
    this.name = 'LiveUnsupportedError';
  }
}

const OUT_W = 1080;
const OUT_H = 1440; // 3:4 竖版
const FPS = 30;
const HOLD_FRAMES = 22; // 每个跨页停留 ~0.73s
// 翻页/开合时长逐帧对齐移动端(900ms / 700ms + FLIP_EASE),不再另拍一套「视频专用」节奏。
const SPREAD_FLIP_FRAMES = transitionFrameCount(FLIP_MS, FPS); // 27
const EDGE_FLIP_FRAMES = transitionFrameCount(EDGE_FLIP_MS, FPS); // 21
const FADE_FRAMES = 8; // 翻不了的场景(双宽#303 等,移动端直切)在视频里用短淡入淡出
const FACE_SCALE = 2; // 单 face 截图倍率(会缩到半页显示,2 足够清晰)
// H.264 codec 候选:1080×1440=1.55M 采样超 Level 3.1(720p)上限,必须 Level 4.0(0028)起。
// High → Main → Baseline @L4.0,再退 L4.1/L5;取第一个 isConfigSupported 的。
const CODEC_CANDIDATES = ['avc1.640028', 'avc1.4d0028', 'avc1.420028', 'avc1.640029', 'avc1.640032'];

// 书在竖版画布里的位置(横向跨页居中)。
//
// 2026-08-11:书从 900 收到 760,腾出的横向空间给两侧的扇形页堆。参考录屏是横屏
// 构图(书占宽 52%、两侧扇形各 21%),照搬到 3:4 竖版书只剩 560 宽、跨页高 252 ——
// 页面上的字会糊掉,而 Live 视频就是拿去给人看这本书的。760 是「一眼还是厚厚一本」
// 与「页面看得清」的折中(跨页高 537,是原先的 85%)。桌面 Live翻书版式预览.html
// 是这组数的调参台。
const BOOK_W = 760;
const HALF_W = BOOK_W / 2; // 380
const BOOK_H = BOOK_W / ((PAGE.width * 2) / PAGE.height); // ≈537
const BOOK_X = (OUT_W - BOOK_W) / 2; // 160
const BOOK_Y = (OUT_H - BOOK_H) / 2;
const SPINE = BOOK_X + HALF_W; // 540 = 画布中线
const SOLO_X = (OUT_W - HALF_W) / 2; // 封面/封尾:单页居中,无空白半页

// 扇形页堆的出片参数住在 live-fan-geometry(几何与它同一份真相,顺带被出画守卫盯着)。
const FAN = LIVE_FAN_SHAPE;
/** 扇形卡自己的投影(比翻动那张纸轻:它们是垫在底下的)。 */
const FAN_SHADOW: DropShadow = { y: 8, blur: 16, color: 'rgba(8,12,20,.42)' };
/** 扇形卡外口的 1px 受光细边 —— 卡挨得密,没有它会糊成一坨。 */
const FAN_EDGE_RING = { w: 1, color: 'rgba(255,255,255,.18)' } as const;

/** 垫底背景上的暗角:让卡片投影立得住,深底浅底都聚焦到书上。 */
const VIGNETTE = 0.42;

/** 网格一格的宽高比 = 跨页比例。结尾段的帧账全在 live-grid-motion 的 gridTailFrames。 */
const GRID_CELL_RATIO = (PAGE.width * 2) / PAGE.height;

// 1080×1440 = 360×480pt 手机 @3x:mobile-editor.css 里的 CSS px 一律 ×3 落到画布,
// 阴影/纸叠/沟槽/透视的相对强度才与手机上看到的一致。
const CSS_DPR = 3;
const px = (v: number) => v * CSS_DPR;

export interface LiveVideoOptions {
  background?: BoardBackground | null;
  onProgress?: (done: number, total: number) => void; // done/total 按帧计
}

// 一屏上的一个面:页数组下标 + 双宽页(#303)的裁半标记。
// 「拆渲染不拆数据」:双宽页在数据上仍是一页,书上是装订在一起的左右两个半面,
// half 随引用走进 leafLayers/edgeLayers(泛型洗牌,不解读元素),翻页与普通跨页同路。
type FaceRef = { idx: number; half?: 'left' | 'right' } | null;

// 一个「视图」= 一屏。封面/封尾是 solo 居中单页;内页是双页跨页;
// 双宽(#303)页 = 同一页的左半裁 + 右半裁(有中缝,与移动端/FlipBook 同款)。
interface View {
  solo: boolean;
  /** 双宽页(#303)。 */
  full: boolean;
  /** 封面/封尾的明确角色(与移动端 shapeOf 同判据),开合动画靠它。 */
  role: 'cover' | 'ending' | null;
  /** 面布局,与移动端 resting.faces 同构(solo 1 面,pair/full 2 面)。 */
  faces: FaceRef[];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('bg image load failed: ' + src));
    img.src = src;
  });
}

// 取第一个被支持的 H.264 codec 串;都不支持返回 null。
async function pickCodec(): Promise<string | null> {
  if (typeof window === 'undefined' || typeof window.VideoEncoder === 'undefined') return null;
  for (const codec of CODEC_CANDIDATES) {
    try {
      const res = await window.VideoEncoder.isConfigSupported({
        codec, width: OUT_W, height: OUT_H, bitrate: 4_000_000, framerate: FPS,
      });
      if (res.supported) return codec;
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function isLiveSupported(): Promise<boolean> {
  return (await pickCodec()) != null;
}

// ── 绘制原语(都不画背景,背景由调用方先铺)────────────────────────────────────

function drawFace(ctx: CanvasRenderingContext2D, face: HTMLCanvasElement | null, x: number, w: number) {
  if (w <= 0) return;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, BOOK_Y, w, BOOK_H);
  if (face) ctx.drawImage(face, x, BOOK_Y, w, BOOK_H);
}

/** box-shadow 的画布版:把矩形画到视野外,只收投影(offsetX 搬回来)。 */
function paintDropShadows(ctx: CanvasRenderingContext2D, x: number, w: number, shadows: DropShadow[]) {
  for (const s of shadows) {
    ctx.save();
    ctx.shadowColor = s.color;
    ctx.shadowBlur = px(s.blur);
    ctx.shadowOffsetX = 3000;
    ctx.shadowOffsetY = px(s.y);
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 3000, BOOK_Y, w, BOOK_H);
    ctx.restore();
  }
}

/** 书口纸叠(mspread 的 ±x 偏移 + 负 spread box-shadow):逐层内缩、lit/shade 交替。
 *  CSS 列表越靠前越在上,所以从最深那层往回画。 */
function paintPaperStack(ctx: CanvasRenderingContext2D, x: number, w: number) {
  for (let i = PAPER_STACK.length - 1; i >= 0; i--) {
    const s = PAPER_STACK[i]!;
    const inset = px(s.shrink);
    ctx.fillStyle = s.color;
    ctx.fillRect(x - px(s.x) + inset, BOOK_Y + inset, w - inset * 2, BOOK_H - inset * 2);
    ctx.fillRect(x + px(s.x) + inset, BOOK_Y + inset, w - inset * 2, BOOK_H - inset * 2);
  }
}

/** 左右半页向书脊的弧面明暗(mpage::before,只在两半都是真页时套)。 */
function paintPageCurvature(ctx: CanvasRenderingContext2D, x: number, w: number) {
  const half = w / 2;
  const gl = ctx.createLinearGradient(x, 0, x + half, 0);
  for (const s of PAGE_SPINE_LEFT) gl.addColorStop(s.at, stopCss(s.color));
  ctx.fillStyle = gl;
  ctx.fillRect(x, BOOK_Y, half, BOOK_H);
  const gr = ctx.createLinearGradient(x + half, 0, x + w, 0);
  for (const s of PAGE_SPINE_RIGHT) gr.addColorStop(s.at, stopCss(s.color));
  ctx.fillStyle = gr;
  ctx.fillRect(x + half, BOOK_Y, half, BOOK_H);
}

/** 书脊沟槽折光带 + 1px 接缝(mspread::before/::after)。 */
function paintSpineChrome(ctx: CanvasRenderingContext2D, spineX: number) {
  const w = px(SPINE_CREASE_WIDTH);
  const g = ctx.createLinearGradient(spineX - w / 2, 0, spineX + w / 2, 0);
  for (const s of SPINE_CREASE) g.addColorStop(s.at, stopCss(s.color));
  ctx.fillStyle = g;
  ctx.fillRect(spineX - w / 2, BOOK_Y, w, BOOK_H);
  ctx.fillStyle = SPINE_SEAM.lit;
  ctx.fillRect(spineX - px(1.5), BOOK_Y, px(1), BOOK_H);
  ctx.fillStyle = SPINE_SEAM.shade;
  ctx.fillRect(spineX + px(0.5), BOOK_Y, px(1), BOOK_H);
  ctx.fillStyle = SPINE_SEAM.color;
  ctx.fillRect(spineX - px(0.5), BOOK_Y, px(1), BOOK_H);
}

/** 内圈描边(inset box-shadow 的 0 0 0 w 形态)。数组顺序 = 从底往上画。 */
function paintInsetRings(
  ctx: CanvasRenderingContext2D,
  x: number,
  w: number,
  rings: readonly { w: number; color: string }[],
) {
  for (const r of rings) {
    ctx.strokeStyle = r.color;
    ctx.lineWidth = px(r.w);
    ctx.strokeRect(x + px(r.w) / 2, BOOK_Y + px(r.w) / 2, w - px(r.w), BOOK_H - px(r.w));
  }
}

/** 垫底背景上的暗角。画布只有圆形径向渐变,按画幅比例压扁成椭圆。 */
function paintVignette(ctx: CanvasRenderingContext2D) {
  const cx = OUT_W / 2;
  const cy = OUT_H / 2;
  const rx = OUT_W * 0.62;
  const ry = OUT_H * 0.56;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0.34, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${VIGNETTE})`);
  ctx.fillStyle = g;
  const h = (OUT_H * rx) / ry;
  ctx.fillRect(-OUT_W, -h, OUT_W * 2, h * 2);
  ctx.restore();
}

/** 预渲一张「只有投影、没有本体」的精灵:之后逐帧只 drawImage,不再现算高斯模糊。
 *  精灵里本体矩形落在 (m, m),所以按 k 缩放贴图时投影强度也随 k 缩 —— 与逐帧
 *  现算 `shadowBlur = px(blur) * k` 等价。 */
type ShadowSprite = { canvas: HTMLCanvasElement; m: number };
function makeShadowSprite(w: number, h: number, s: DropShadow): ShadowSprite {
  const blur = px(s.blur);
  const dy = px(s.y);
  const m = Math.ceil(blur * 1.5 + Math.abs(dy) + 4);
  const c = document.createElement('canvas');
  c.width = Math.ceil(w + m * 2);
  c.height = Math.ceil(h + m * 2);
  const g = c.getContext('2d')!;
  g.shadowColor = s.color;
  g.shadowBlur = blur;
  g.shadowOffsetX = 3000; // 本体画到视野外,只把影子留在精灵里
  g.shadowOffsetY = dy;
  g.fillStyle = '#000';
  g.fillRect(m - 3000, m, w, h);
  return { canvas: c, m };
}

/** 把投影精灵贴到 (x,y) —— 让精灵里的本体矩形正好落在 (x, y, w·k, h·k)。 */
function drawShadowSprite(ctx: CanvasRenderingContext2D, sp: ShadowSprite, x: number, y: number, k: number) {
  ctx.drawImage(
    sp.canvas,
    x - sp.m * k, y - sp.m * k,
    sp.canvas.width * k, sp.canvas.height * k,
  );
}

/** 一张扇形卡:投影 → 白纸底 → 页面内容 → 纵深压暗 → 外口细边。全是正矩形。 */
function paintFanCard(
  ctx: CanvasRenderingContext2D,
  face: HTMLCanvasElement | null,
  c: { x: number; y: number; w: number; h: number; k: number; dark: number },
  shadow: ShadowSprite,
) {
  if (c.w <= 0.5 || c.h <= 0.5) return;
  drawShadowSprite(ctx, shadow, c.x, c.y, c.k);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(c.x, c.y, c.w, c.h);
  if (face) ctx.drawImage(face, c.x, c.y, c.w, c.h);
  if (c.dark > 0) {
    ctx.fillStyle = `rgba(10,14,22,${c.dark.toFixed(4)})`;
    ctx.fillRect(c.x, c.y, c.w, c.h);
  }
  const rw = px(FAN_EDGE_RING.w);
  ctx.strokeStyle = FAN_EDGE_RING.color;
  ctx.lineWidth = rw;
  ctx.strokeRect(c.x + rw / 2, c.y + rw / 2, c.w - rw, c.h - rw);
}

/** 摊开的书(pair):投影层 + 纸叠 + 两张面 + 弧面明暗 + 书脊沟槽。 */
function paintOpenBook(
  ctx: CanvasRenderingContext2D,
  chrome: HTMLCanvasElement,
  left: HTMLCanvasElement | null,
  right: HTMLCanvasElement | null,
) {
  ctx.drawImage(chrome, 0, 0);
  paintPaperStack(ctx, BOOK_X, BOOK_W);
  drawFace(ctx, left, BOOK_X, HALF_W);
  drawFace(ctx, right, SPINE, HALF_W);
  // 与移动端 data-paper-spine 同判据:两半都是真页才有沟槽和弧面(空半边不画折痕)。
  if (left && right) {
    paintPageCurvature(ctx, BOOK_X, BOOK_W);
    paintSpineChrome(ctx, SPINE);
  }
}

type ChromeLayers = {
  /** 摊开书体(pair/full)的三层加深投影,预渲一次 —— 70px 高斯模糊逐帧现算太贵。 */
  spread: HTMLCanvasElement;
  /** 独页封皮投影。 */
  solo: HTMLCanvasElement;
  /** 开合动画的书体投影(medge-shadow 终值),随书体平移、按进度定透明度。 */
  edge: HTMLCanvasElement;
};

/** 翻动中的那张纸:绕书脊 rotateY 的真透视投影,逐列切片(与 .mboard 的
 *  perspective:2400 同参)。正反面受光、纸边渐变、内圈、叶片投影全按 mleaf-*。 */
function paintLeaf(
  ctx: CanvasRenderingContext2D,
  leaf: {
    front: HTMLCanvasElement | null;
    back: HTMLCanvasElement | null;
    spineX: number;
    /** 0° 时纸片摊在书脊哪一侧:+1 右(封面/next),-1 左(封尾)。 */
    side: 1 | -1;
    angle: number; // CSS rotateY 度数
    dir: FlipDir;
  },
) {
  const p = px(PERSPECTIVE);
  const originX = OUT_W / 2;
  const cy = BOOK_Y + BOOK_H / 2;
  const W = HALF_W;
  const proj = (u: number) => projectLeafColumn(u, leaf.angle, leaf.side, leaf.spineX, originX, p);
  const root = proj(0);
  const tip = proj(W);
  if (Math.abs(tip.x - root.x) < 0.75) return; // 侧立成一条线,这一帧没有可画的面

  const quad = (dx: number) => {
    ctx.beginPath();
    ctx.moveTo(root.x + dx, cy - (BOOK_H / 2) * root.k);
    ctx.lineTo(tip.x + dx, cy - (BOOK_H / 2) * tip.k);
    ctx.lineTo(tip.x + dx, cy + (BOOK_H / 2) * tip.k);
    ctx.lineTo(root.x + dx, cy + (BOOK_H / 2) * root.k);
    ctx.closePath();
  };

  // 叶片自己的投影(mleaf-face box-shadow):轮廓画到视野外,只收影子。
  ctx.save();
  ctx.shadowColor = LEAF_SHADOW.color;
  ctx.shadowBlur = px(LEAF_SHADOW.blur);
  ctx.shadowOffsetX = 3000;
  ctx.shadowOffsetY = px(LEAF_SHADOW.y);
  quad(-3000);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();

  const cos = Math.cos((leaf.angle * Math.PI) / 180);
  const frontVisible = cos >= 0;
  const src = frontVisible ? leaf.front : leaf.back;
  // 元素坐标即内容坐标(背面经 rotateY(180) 翻回正读向,推导见 live-flip-motion)。
  // 无论正背/哪一侧,内容比例 f 都随屏幕 x 递增 —— 镜像与投影方向两次翻转互相抵消。
  const mirror = frontVisible ? leaf.side === -1 : leaf.side === 1;
  const shade = leafShadeStops(leaf.dir);
  const STEPS = 240;
  type Slice = { x: number; w: number; y: number; h: number; f0: number; f1: number };
  const slices: Slice[] = [];
  for (let i = 0; i < STEPS; i++) {
    const u0 = (i / STEPS) * W;
    const u1 = ((i + 1) / STEPS) * W;
    const a = proj(u0);
    const b = proj(u1);
    const k = (a.k + b.k) / 2;
    slices.push({
      x: Math.min(a.x, b.x),
      w: Math.abs(b.x - a.x),
      y: cy - (BOOK_H / 2) * k,
      h: BOOK_H * k,
      f0: mirror ? 1 - u1 / W : u0 / W,
      f1: mirror ? 1 - u0 / W : u1 / W,
    });
  }
  // 第一遍:白纸底 + 页面内容。每列独立采样源图会拼出竖条纹(相邻列的取整/双线性
  // 各自为政),所以每列画的是「整面连续映射在本列的线性近似」:相邻列在边界上取值
  // 一致,再用微量出血的 clip 防浮点缝。
  for (const s of slices) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(s.x - 0.35, s.y, s.w + 0.7, s.h);
    ctx.clip();
    ctx.fillStyle = '#ffffff'; // --surface:空半边也是一张真实的白纸
    ctx.fillRect(s.x - 0.35, s.y, s.w + 0.7, s.h);
    if (src) {
      const sx0 = s.f0 * src.width;
      const sx1 = s.f1 * src.width;
      const scaleX = s.w / Math.max(1e-6, sx1 - sx0);
      const pad = 3;
      const p0 = Math.max(0, sx0 - pad);
      const p1 = Math.min(src.width, sx1 + pad);
      ctx.drawImage(
        src,
        p0, 0, p1 - p0, src.height,
        s.x + (p0 - sx0) * scaleX, s.y, (p1 - p0) * scaleX, s.h,
      );
    }
    ctx.restore();
  }
  // 第二遍:受光层。精确边界、零重叠 —— 浮点相邻边在抗锯齿下互补,半透明色
  // 不叠加;带重叠画会在每条接缝落一根更深的细线。
  for (const s of slices) {
    const fm = (s.f0 + s.f1) / 2;
    const edge = sampleStops(frontVisible ? LEAF_FRONT_EDGE : LEAF_BACK_EDGE, fm);
    if (edge[3] > 0) {
      ctx.fillStyle = stopCss(edge);
      ctx.fillRect(s.x, s.y, s.w, s.h);
    }
    if (frontVisible) {
      const sh = sampleStops(shade, fm);
      if (sh[3] > 0) {
        ctx.fillStyle = stopCss(sh);
        ctx.fillRect(s.x, s.y, s.w, s.h);
      }
    }
  }
  // 1px 内圈(mleaf-face::after 的 inset 白圈),收在投影后的梯形内。
  ctx.save();
  quad(0);
  ctx.clip();
  quad(0);
  ctx.strokeStyle = LEAF_INSET_RING.color;
  ctx.lineWidth = px(LEAF_INSET_RING.w) * 2; // clip 吃掉外半,剩内侧 1px
  ctx.stroke();
  ctx.restore();
}

export async function renderLiveVideo(
  pages: (AdaptablePage & { html?: string })[],
  resolveImage: ResolveImage,
  options: LiveVideoOptions = {},
): Promise<Blob> {
  const codec = await pickCodec();
  if (!codec) throw new LiveUnsupportedError();
  await loadAlbumFonts(pages).catch(() => undefined);

  const spreads: Spread[] = buildSpreads(pages as unknown as EditorPage[]);
  if (spreads.length === 0) throw new Error('no pages to render');

  // 解析垫底背景(与预览/拼图同源)。
  const bg = options.background ?? null;
  let bgImage: HTMLImageElement | null = null;
  if (bg?.kind === 'preset') bgImage = await loadImage(presetImageUrl(bg.presetId)).catch(() => null);
  else if (bg?.kind === 'upload') bgImage = await loadBoardUpload(bg.key, loadImage);
  const paintBg = (ctx: CanvasRenderingContext2D) => {
    if (bg?.kind === 'color') { ctx.fillStyle = bg.color; ctx.fillRect(0, 0, OUT_W, OUT_H); }
    else if (bgImage) {
      const scale = Math.max(OUT_W / bgImage.width, OUT_H / bgImage.height);
      const w = bgImage.width * scale, h = bgImage.height * scale;
      ctx.drawImage(bgImage, (OUT_W - w) / 2, (OUT_H - h) / 2, w, h);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, OUT_H);
      g.addColorStop(0, '#eef1f3'); g.addColorStop(1, '#f5f4f1');
      ctx.fillStyle = g; ctx.fillRect(0, 0, OUT_W, OUT_H);
    }
  };

  // 逐 face 渲染(缓存)。折页号与画板同源。
  const total = pages.length;
  const folioInfos = pageFolioInfos(pages.map((p) => p.templateId));
  const faceCache = new Map<number, HTMLCanvasElement>();
  async function face(idx: number | null): Promise<HTMLCanvasElement | null> {
    if (idx == null) return null;
    const cached = faceCache.get(idx);
    if (cached) return cached;
    const c = await renderFaceToCanvas(pages[idx]!, resolveImage, {
      scale: FACE_SCALE, total,
      folio: folioInfos[idx]?.folio ?? null,
      folioSide: folioInfos[idx]?.side ?? 'right',
    });
    faceCache.set(idx, c);
    return c;
  }
  // 面引用 → 画布。双宽页的半面在这里裁(源画布左/右半),裁一次进缓存。
  const halfCache = new Map<string, HTMLCanvasElement>();
  const faceOf = (ref: FaceRef): HTMLCanvasElement | null => {
    if (ref == null) return null;
    const base = faceCache.get(ref.idx) ?? null;
    if (!base || !ref.half) return base;
    const key = `${ref.idx}:${ref.half}`;
    const cached = halfCache.get(key);
    if (cached) return cached;
    const c = document.createElement('canvas');
    c.width = Math.floor(base.width / 2);
    c.height = base.height;
    c.getContext('2d')!.drawImage(
      base,
      ref.half === 'left' ? 0 : base.width / 2, 0, base.width / 2, base.height,
      0, 0, c.width, c.height,
    );
    halfCache.set(key, c);
    return c;
  };

  // 视图序列:封面/封尾按 solo 居中单页,内页按双页跨页。
  const asEditor = pages as unknown as EditorPage[];
  const views: View[] = [];
  for (const s of spreads) {
    // 三选一的分类住在 spreads.ts(唯一真相),这里只负责把它变成一屏画面。
    switch (spreadRenderKind(s, asEditor)) {
      case 'full': {
        // 双宽(#303)页:同一页裁成装订在一起的左右两半(有中缝,参与翻页)。
        const pi = spreadFullPage(s)!;
        await face(pi);
        views.push({
          solo: false, full: true, role: null,
          faces: [{ idx: pi, half: 'left' }, { idx: pi, half: 'right' }],
        });
        break;
      }
      case 'solo': {
        // 封面/封尾只占半边;取它实际占的那一页,角色判据与移动端 shapeOf 同一条。
        const pi = spreadPageIndices(s)[0] ?? null;
        const slot = pi != null && asEditor[pi] ? pageSlot(asEditor[pi]!) : null;
        await face(pi);
        views.push({
          solo: true, full: false,
          role: slot === 'cover' || slot === 'ending' ? slot : null,
          faces: [pi == null ? null : { idx: pi }],
        });
        break;
      }
      default: {
        const l = s.kind === 'pair' ? s.left : null;
        const r = s.kind === 'pair' ? s.right : null;
        await face(l);
        await face(r);
        views.push({
          solo: false, full: false, role: null,
          faces: [l == null ? null : { idx: l }, r == null ? null : { idx: r }],
        });
      }
    }
  }

  // 相邻两屏怎么过渡:与移动端同一双眼睛(flipTransition)。视频永远向后翻(next)。
  // 翻不了的(双宽#303、形状不匹配)移动端直切,视频里剪硬切太跳 → 短淡入淡出。
  const shapeOf = (v: View): ScreenShape => ({
    rows: 1,
    faces: v.faces.length,
    soloRole: v.role,
    full: v.full,
  });
  const n = views.length;
  const transitions: (FlipTransition | null)[] = [];
  for (let k = 0; k + 1 < n; k++) {
    transitions.push(flipTransition(shapeOf(views[k]!), shapeOf(views[k + 1]!), 'next', false));
  }
  const framesOf = (tr: FlipTransition | null) =>
    tr == null ? FADE_FRAMES : tr === 'spread' ? SPREAD_FLIP_FRAMES : EDGE_FLIP_FRAMES;

  // 静态书影预渲(模糊半径最大 70×3 px,逐帧现算太贵;书影不随帧变,画一次够了)。
  const layer = (paint: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = OUT_W; c.height = OUT_H;
    paint(c.getContext('2d')!);
    return c;
  };
  const chrome: ChromeLayers = {
    spread: layer((c) => paintDropShadows(c, BOOK_X, BOOK_W, SPREAD_BOOK_SHADOW)),
    solo: layer((c) => paintDropShadows(c, SOLO_X, HALF_W, SOLO_BOOK_SHADOW)),
    edge: layer((c) => paintDropShadows(c, BOOK_X, BOOK_W, EDGE_BOOK_SHADOW)),
  };
  /** 垫底背景 + 暗角都不随帧变(背景可能是几千像素的大图,暗角是整幅渐变),
   *  与上面的书影同理:画一次,逐帧贴。 */
  const ground = layer((c) => { paintBg(c); paintVignette(c); });
  /** 扇形卡的投影精灵。所有卡都是 HALF_W×BOOK_H 的等比缩放,一张就够。 */
  const fanShadow = makeShadowSprite(HALF_W, BOOK_H, FAN_SHADOW);
  // face 原画布是 1588×2246(≈3.6Mpx),而扇形卡最大不过 HALF_W×BOOK_H。
  // 逐帧拿原图做高质量降采样,一帧 14 次、长相册几万次 —— 先按最大卡尺寸降一次,
  // 之后每帧只是小图之间的缩放。代价是每张 face 多存 ≈0.8MB(原图本就缓存着 14MB)。
  const fanFaceCache = new Map<HTMLCanvasElement, HTMLCanvasElement>();
  function fanFaceOf(src: HTMLCanvasElement | null): HTMLCanvasElement | null {
    if (!src) return null;
    const hit = fanFaceCache.get(src);
    if (hit) return hit;
    const c = document.createElement('canvas');
    c.width = Math.ceil(HALF_W);
    c.height = Math.ceil(BOOK_H);
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c.width, c.height);
    fanFaceCache.set(src, c);
    return c;
  }

  // 画一个视图的「书」:solo=居中单页;pair 与双宽(#303)同一条路 —— 双宽已在
  // faces 里裁成左右两半,paintOpenBook 照常给中缝/弧面/纸叠(与移动端同款)。
  function paintViewBook(ctx: CanvasRenderingContext2D, v: View) {
    if (v.solo) {
      ctx.drawImage(chrome.solo, 0, 0);
      drawFace(ctx, faceOf(v.faces[0] ?? null), SOLO_X, HALF_W);
      paintInsetRings(ctx, SOLO_X, HALF_W, SOLO_INSET_RINGS);
    } else {
      paintOpenBook(ctx, chrome.spread, faceOf(v.faces[0] ?? null), faceOf(v.faces[1] ?? null));
    }
  }

  // 摊在书两侧的整本页堆。每张卡是正矩形(几何与推导见 live-fan-geometry),
  // pos 允许带小数 —— 翻页时把缓动后的进度直接加进去,整摞就随那张纸推进一格,
  // 不为扇形另写一套动画。封面/封尾是合着的书,没有摊开的页堆:alpha 由调用方
  // 按开合进度给,合着时为 0。
  function paintFan(ctx: CanvasRenderingContext2D, pos: number, spineX: number, alpha: number) {
    if (alpha <= 0) return;
    const cards = fanCards(pos, n, {
      ...FAN,
      bookW: BOOK_W,
      bookH: BOOK_H,
      spineX,
      centerY: BOOK_Y + BOOK_H / 2,
    });
    if (cards.length === 0) return;
    ctx.save();
    // **相乘不覆写**:调用方可能正处在交叉淡出里(已经设了 globalAlpha),
    // 直接赋值会让页堆不跟着淡,在网格的列距里透出来再突然消失。
    ctx.globalAlpha = ctx.globalAlpha * alpha;
    for (const c of cards) {
      const v = views[c.view]!;
      const face = faceOf(v.faces[fanFaceIndex(v.faces.length, c.side)] ?? null);
      paintFanCard(ctx, fanFaceOf(face), c, fanShadow);
    }
    ctx.restore();
  }
  /** 摊开的书才有页堆;封面/封尾合着时没有。 */
  const fanAlphaOf = (v: View) => (v.solo ? 0 : 1);

  // 跨页→跨页翻页:与移动端 spread 翻纸同一套图层(leafLayers)与几何(leafGeometry)。
  function paintSpreadFlip(ctx: CanvasRenderingContext2D, a: View, b: View, t: number) {
    const dir: FlipDir = 'next';
    const layers = leafLayers(dir, 2, a.faces, b.faces);
    paintOpenBook(ctx, chrome.spread, faceOf(layers.under[0] ?? null), faceOf(layers.under[1] ?? null));
    const geo = leafGeometry(dir, 2);
    paintLeaf(ctx, {
      front: faceOf(layers.front),
      back: faceOf(layers.back),
      spineX: SPINE,
      side: geo.origin === 'left center' ? 1 : -1,
      angle: geo.endAngle * flipEase(t),
      dir,
    });
  }

  // 开合过程里书脊的横向位置。扇形页堆要跟着书一起走,所以直接给到书脊 ——
  // 给平移量的话,外面还得再推一次 `bookX + HALF_W`,又是第二处推导。
  const edgeSpineOf = (em: ReturnType<typeof edgeMotion>, e: number) =>
    BOOK_X + ((em.startShiftPct + (em.endShiftPct - em.startShiftPct) * e) / 100) * BOOK_W + HALF_W;

  // 封面开卷 / 封底合卷:书体平移 + 半宽封皮绕书脊翻(edgeMotion/edgeLayers),
  // 正文与书脊按 medge-under-* 的时间线显隐,书影按 medge-shadow-* 渐入渐出。
  function paintEdgeFlip(
    ctx: CanvasRenderingContext2D,
    transition: Exclude<FlipTransition, 'spread'>,
    a: View,
    b: View,
    t: number,
  ) {
    const em = edgeMotion(transition);
    const layers = edgeLayers(transition, a.faces, b.faces);
    const e = flipEase(t);
    const spineX = edgeSpineOf(em, e);
    const bookX = spineX - HALF_W;
    const shadowProgress = em.opening ? tokenEase(t) : 1 - tokenEase(t);
    if (shadowProgress > 0) {
      ctx.save();
      ctx.globalAlpha = ctx.globalAlpha * shadowProgress;
      ctx.drawImage(chrome.edge, bookX - BOOK_X, 0);
      ctx.restore();
    }
    const under = edgeUnderAlpha(em.opening, t * EDGE_FLIP_MS);
    if (under > 0) {
      ctx.save();
      ctx.globalAlpha = under;
      drawFace(ctx, faceOf(layers.under[0] ?? null), bookX, HALF_W);
      drawFace(ctx, faceOf(layers.under[1] ?? null), spineX, HALF_W);
      if (layers.under[0] != null && layers.under[1] != null) {
        paintPageCurvature(ctx, bookX, BOOK_W);
        paintSpineChrome(ctx, spineX);
      }
      ctx.restore();
    }
    paintLeaf(ctx, {
      front: faceOf(layers.front),
      back: faceOf(layers.back),
      spineX,
      side: em.leftFrac === 0 ? -1 : 1,
      angle: em.startAngle + (em.endAngle - em.startAngle) * e,
      dir: 'next',
    });
  }

  // ── 结尾「全部页面一览」──────────────────────────────────────────────
  // 翻完最后一屏,把整本书铺成三列缩略图从顶滚到底。排布与滚动时间线全在
  // live-grid-motion(纯函数、单测锁住「正好停在底」),这里只负责画。
  const grid: GridSpec = gridSpec(n, OUT_W, OUT_H, GRID_CELL_RATIO);
  const tail = gridTailFrames(grid.scroll, FPS);
  /** 网格格子的投影精灵:整格一张、solo 半格一张,两种尺寸够用。 */
  const gridShadow = {
    full: makeShadowSprite(grid.cellW, grid.cellH, FAN_SHADOW),
    half: makeShadowSprite(grid.cellW / 2, grid.cellH, FAN_SHADOW),
  };
  /** 格子滚出画幅多远才不画。投影往下要铺到卡底以下 offset+blur,
   *  按格子边界裁会在滚动时于画面顶端闪一道暗带。 */
  const GRID_CULL = px(FAN_SHADOW.y) + px(FAN_SHADOW.blur);

  /** 一格 = 一屏。solo(封面/封尾)只占半格宽居中,四周透出垫底背景。 */
  type Thumb = { canvas: HTMLCanvasElement; x: number; w: number };
  function renderThumb(v: View): Thumb {
    const cw = Math.max(1, Math.round(grid.cellW));
    const ch = Math.max(1, Math.round(grid.cellH));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    const half = cw / 2;
    if (v.solo) {
      const x = half / 2;
      g.fillStyle = '#ffffff';
      g.fillRect(x, 0, half, ch);
      const f = faceOf(v.faces[0] ?? null);
      if (f) g.drawImage(f, x, 0, half, ch);
      return { canvas: c, x, w: half };
    }
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, cw, ch);
    const l = faceOf(v.faces[0] ?? null);
    const r = faceOf(v.faces[1] ?? null);
    if (l) g.drawImage(l, 0, 0, half, ch);
    if (r) g.drawImage(r, half, 0, half, ch);
    return { canvas: c, x: 0, w: cw };
  }

  function paintGrid(ctx: CanvasRenderingContext2D, thumbs: Thumb[], scrollY: number) {
    for (let i = 0; i < thumbs.length; i++) {
      const cell = gridCellRect(i, grid);
      const y = cell.y - scrollY;
      if (y + cell.h < -GRID_CULL || y > OUT_H + GRID_CULL) continue; // 画幅外的格子不画
      const t = thumbs[i]!;
      const sx = cell.x + (t.x / t.canvas.width) * cell.w;
      const sprite = t.w >= t.canvas.width ? gridShadow.full : gridShadow.half;
      drawShadowSprite(ctx, sprite, sx, y, 1);
      ctx.drawImage(t.canvas, cell.x, y, cell.w, cell.h);
    }
  }

  // ── 编码 ──
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: OUT_W, height: OUT_H },
    fastStart: 'in-memory',
  });
  const encoder = new window.VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e; },
  });
  encoder.configure({ codec, width: OUT_W, height: OUT_H, bitrate: 4_000_000, framerate: FPS });

  const canvas = document.createElement('canvas');
  canvas.width = OUT_W; canvas.height = OUT_H;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const totalFrames =
    n * HOLD_FRAMES + transitions.reduce((sum, tr) => sum + framesOf(tr), 0) + tail.total;
  let frameIdx = 0;
  // 背压:每帧 VideoFrame 约 6MB,超长相册若一次性堆满编码队列会爆内存。
  // 队列超阈值就让出主线程等编码器消化,把在飞帧数压到个位数。
  async function emit() {
    while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
    const vf = new window.VideoFrame(canvas, {
      timestamp: Math.round((frameIdx * 1e6) / FPS),
      duration: Math.round(1e6 / FPS),
    });
    encoder.encode(vf, { keyFrame: frameIdx % (FPS * 2) === 0 });
    vf.close();
    frameIdx += 1;
    options.onProgress?.(frameIdx, totalFrames);
  }

  // 每帧的底:垫底背景(用户在编辑器里选的那张)+ 暗角,都不随帧变,预渲一次贴过来。
  // 暗角压在背景上、书之下,深底浅底都能把视线收到书上,扇形卡的投影也才立得住。
  const paintGround = (ctx: CanvasRenderingContext2D) => {
    ctx.drawImage(ground, 0, 0);
  };

  for (let k = 0; k < n; k++) {
    const a = views[k]!;
    // 停留
    paintGround(ctx);
    paintFan(ctx, k, SPINE, fanAlphaOf(a));
    paintViewBook(ctx, a);
    for (let f = 0; f < HOLD_FRAMES; f++) await emit();
    // 过渡到下一视图
    if (k < n - 1) {
      const b = views[k + 1]!;
      const tr = transitions[k]!;
      const frames = framesOf(tr);
      for (let f = 0; f < frames; f++) {
        const t = (f + 1) / (frames + 1);
        paintGround(ctx);
        if (tr === 'spread') {
          // 页堆与那张纸同一条缓动:整摞随翻页恰好推进一格。
          paintFan(ctx, k + flipEase(t), SPINE, 1);
          paintSpreadFlip(ctx, a, b, t);
        } else if (tr != null) {
          // 开合过程中书体在平移,页堆跟着走;开卷渐入、合卷渐出。
          const em = edgeMotion(tr);
          const alpha = em.opening ? tokenEase(t) : 1 - tokenEase(t);
          paintFan(ctx, k + flipEase(t), edgeSpineOf(em, flipEase(t)), alpha);
          paintEdgeFlip(ctx, tr, a, b, t);
        } else {
          // 淡入淡出:先画 A(渐隐)再画 B(渐显),起点纯 A、终点纯 B,无空白半页。
          ctx.globalAlpha = 1 - t;
          paintFan(ctx, k + t, SPINE, fanAlphaOf(a));
          paintViewBook(ctx, a);
          ctx.globalAlpha = t;
          paintFan(ctx, k + t, SPINE, fanAlphaOf(b));
          paintViewBook(ctx, b);
          ctx.globalAlpha = 1;
        }
        await emit();
      }
    }
  }

  // ── 结尾:全部页面一览 ──
  // 缩略图到这里才渲:翻页阶段用不到,提前建等于白占内存。
  const thumbs = views.map(renderThumb);
  const lastView = views[n - 1]!;
  for (let f = 0; f < tail.fade; f++) {
    const t = (f + 1) / (tail.fade + 1);
    paintGround(ctx);
    ctx.globalAlpha = 1 - t;
    paintFan(ctx, n - 1, SPINE, fanAlphaOf(lastView));
    paintViewBook(ctx, lastView);
    ctx.globalAlpha = t;
    paintGrid(ctx, thumbs, 0);
    ctx.globalAlpha = 1;
    await emit();
  }
  for (let f = 0; f < tail.scroll; f++) {
    paintGround(ctx);
    paintGrid(ctx, thumbs, gridScrollY(f, tail.scroll, grid.scroll));
    await emit();
  }
  // 定格:画布已经停在底,重复取帧即可,不必重画。
  for (let f = 0; f < tail.hold; f++) await emit();

  await encoder.flush();
  muxer.finalize();
  const buffer = (muxer.target as InstanceType<typeof ArrayBufferTarget>).buffer;
  return new Blob([buffer], { type: 'video/mp4' });
}
