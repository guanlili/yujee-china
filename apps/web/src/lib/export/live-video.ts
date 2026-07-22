import type { AdaptablePage, ResolveImage } from '@/components/album/adapt-layout';
import { pageFolioInfos } from '@/components/album/page-html-dom';
import { buildSpreads, isSoloSpread, type Spread } from '@/components/album/spreads';
import type { EditorPage } from '@/components/album/types';
import { PAGE } from '@/components/album/templates/constants';
import { loadAlbumFonts } from '@/lib/font/album-font-loader';
import { renderFaceToCanvas } from '@/lib/pdf/render-raster';
import { presetImageUrl, type BoardBackground } from '@/lib/board-bg/presets';
import { photoStore } from '@/lib/photo/store';

// 上传的垫底背景只存本地(photoStore):blob → 同源 objectURL → 载入(不污染导出画布)。缺失→null→中性底。
async function loadBoardUpload(key: string, load: (src: string) => Promise<HTMLImageElement>): Promise<HTMLImageElement | null> {
  const blob = await photoStore.getBlob(key).catch(() => undefined);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  try { return await load(url); } catch { return null; } finally { URL.revokeObjectURL(url); }
}

// Live·MP4 导出:从封面开始,双页翻页(简化 2D)一直翻到页尾,整本书浮在垫底背景上,
// 输出 3:4 竖版 MP4(1080×1440)。渲染全在前端:每个 face 复用 renderFaceToCanvas,
// 逐帧合成到画布 → WebCodecs VideoEncoder(H.264)→ mp4-muxer 封装成 MP4。
// 不支持 WebCodecs 的浏览器(如 Firefox)抛 LiveUnsupportedError,由调用方友好提示。

export class LiveUnsupportedError extends Error {
  constructor() {
    super('WebCodecs H.264 not supported in this browser');
    this.name = 'LiveUnsupportedError';
  }
}

const OUT_W = 1080;
const OUT_H = 1440; // 3:4 竖版
const FPS = 30;
const HOLD_FRAMES = 22; // 每个跨页停留 ~0.73s(原 1.2s,收紧)
const FLIP_FRAMES = 8; // 翻页过渡 ~0.27s(原 0.6s,翻页最费时,砍到最短还流畅)
const FACE_SCALE = 2; // 单 face 截图倍率(会缩到半页显示,2 足够清晰)
// H.264 codec 候选:1080×1440=1.55M 采样超 Level 3.1(720p)上限,必须 Level 4.0(0028)起。
// High → Main → Baseline @L4.0,再退 L4.1/L5;取第一个 isConfigSupported 的。
const CODEC_CANDIDATES = ['avc1.640028', 'avc1.4d0028', 'avc1.420028', 'avc1.640029', 'avc1.640032'];

// 书在竖版画布里的位置(横向跨页居中)。
const MARGIN_X = 90;
const BOOK_W = OUT_W - MARGIN_X * 2; // 900
const HALF_W = BOOK_W / 2; // 450
const BOOK_H = BOOK_W / ((PAGE.width * 2) / PAGE.height); // ≈636
const BOOK_X = MARGIN_X;
const BOOK_Y = (OUT_H - BOOK_H) / 2;
const SPINE = BOOK_X + HALF_W;
const SOLO_X = (OUT_W - HALF_W) / 2; // 封面/封尾:单页居中,无空白半页

export interface LiveVideoOptions {
  background?: BoardBackground | null;
  onProgress?: (done: number, total: number) => void; // done/total 按帧计
}

// 一个「视图」= 一屏。封面/封尾是 solo 居中单页;内页是双页跨页。
interface View {
  solo: boolean;
  left: HTMLCanvasElement | null;
  right: HTMLCanvasElement | null;
  page: HTMLCanvasElement | null; // solo 时的单页
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

// ── 绘制原语(都不画背景,背景由调用方先铺,方便叠加/淡入淡出)──
function drawBaseRect(ctx: CanvasRenderingContext2D, x: number, w: number) {
  ctx.save();
  ctx.shadowColor = 'rgba(30,40,60,0.24)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, BOOK_Y, w, BOOK_H);
  ctx.restore();
}
function drawFace(ctx: CanvasRenderingContext2D, face: HTMLCanvasElement | null, x: number, w: number) {
  if (w <= 0) return;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, BOOK_Y, w, BOOK_H);
  if (face) ctx.drawImage(face, x, BOOK_Y, w, BOOK_H);
}
function drawSpine(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = 'rgba(30,40,60,0.06)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(SPINE, BOOK_Y);
  ctx.lineTo(SPINE, BOOK_Y + BOOK_H);
  ctx.stroke();
}
// 画一个视图的「书」部分:solo=居中单页(无空白半页/无中缝);跨页=双页+中缝。
function paintViewBook(ctx: CanvasRenderingContext2D, v: View) {
  if (v.solo) {
    drawBaseRect(ctx, SOLO_X, HALF_W);
    drawFace(ctx, v.page, SOLO_X, HALF_W);
  } else {
    drawBaseRect(ctx, BOOK_X, BOOK_W);
    drawFace(ctx, v.left, BOOK_X, HALF_W);
    drawFace(ctx, v.right, SPINE, HALF_W);
    drawSpine(ctx);
  }
}
// 跨页→跨页翻页:转动 A 的右页 → 露出 B。t:0→1。仅内页跨页用。
function paintFlipBook(ctx: CanvasRenderingContext2D, a: View, b: View, t: number) {
  drawBaseRect(ctx, BOOK_X, BOOK_W);
  drawFace(ctx, a.left, BOOK_X, HALF_W);
  drawFace(ctx, b.right, SPINE, HALF_W);
  if (t < 0.5) {
    const th = (t / 0.5) * (Math.PI / 2);
    const w = HALF_W * Math.cos(th);
    drawFace(ctx, a.right, SPINE, w);
    ctx.save();
    ctx.fillStyle = `rgba(20,26,38,${0.28 * (th / (Math.PI / 2))})`;
    ctx.fillRect(SPINE, BOOK_Y, w, BOOK_H);
    ctx.restore();
  } else {
    const th = ((t - 0.5) / 0.5) * (Math.PI / 2);
    const w = HALF_W * Math.sin(th);
    drawFace(ctx, b.left, SPINE - w, w);
    ctx.save();
    ctx.fillStyle = `rgba(20,26,38,${0.28 * (1 - th / (Math.PI / 2))})`;
    ctx.fillRect(SPINE - w, BOOK_Y, w, BOOK_H);
    ctx.restore();
  }
  drawSpine(ctx);
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
  // 视图序列:封面/封尾按 solo 居中单页,内页按双页跨页。
  const asEditor = pages as unknown as EditorPage[];
  const views: View[] = [];
  for (const s of spreads) {
    if (isSoloSpread(s, asEditor)) {
      const idx = s.left ?? s.right; // solo 只占一半
      views.push({ solo: true, left: null, right: null, page: await face(idx) });
    } else {
      views.push({ solo: false, left: await face(s.left), right: await face(s.right), page: null });
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

  const n = views.length;
  const totalFrames = n * HOLD_FRAMES + Math.max(0, n - 1) * FLIP_FRAMES;
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

  for (let k = 0; k < n; k++) {
    const a = views[k]!;
    // 停留
    paintBg(ctx);
    paintViewBook(ctx, a);
    for (let f = 0; f < HOLD_FRAMES; f++) await emit();
    // 过渡到下一视图
    if (k < n - 1) {
      const b = views[k + 1]!;
      const canFlip = !a.solo && !b.solo; // 只有内页↔内页做翻页;含封面/封尾用淡入淡出
      for (let f = 0; f < FLIP_FRAMES; f++) {
        const t = (f + 1) / (FLIP_FRAMES + 1);
        paintBg(ctx);
        if (canFlip) {
          paintFlipBook(ctx, a, b, t);
        } else {
          // 淡入淡出:先画 A(渐隐)再画 B(渐显),起点纯 A、终点纯 B,无空白半页。
          ctx.globalAlpha = 1 - t;
          paintViewBook(ctx, a);
          ctx.globalAlpha = t;
          paintViewBook(ctx, b);
          ctx.globalAlpha = 1;
        }
        await emit();
      }
    }
  }

  await encoder.flush();
  muxer.finalize();
  const buffer = (muxer.target as InstanceType<typeof ArrayBufferTarget>).buffer;
  return new Blob([buffer], { type: 'video/mp4' });
}
