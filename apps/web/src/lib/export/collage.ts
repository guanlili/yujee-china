import type { AdaptablePage, ResolveImage } from '@/components/album/adapt-layout';
import { pageFolioNumbers, pageFolioSides } from '@/components/album/page-html-dom';
import { buildSpreads, isSoloSpread, type Spread } from '@/components/album/spreads';
import type { EditorPage } from '@/components/album/types';
import { PAGE } from '@/components/album/templates/constants';
import { loadAlbumFonts } from '@/lib/font/album-font-loader';
import { renderFaceToCanvas } from '@/lib/pdf/render-raster';
import { presetImageUrl, type BoardBackground } from '@/lib/board-bg/presets';
import { photoStore } from '@/lib/photo/store';

// 上传的垫底背景只存本地(photoStore):取 blob → 同源 objectURL → 载入(不污染导出画布)。
// 载入完成即撤 URL(位图已解码,后续 drawImage 仍有效)。缺失(换设备)返回 null → 回落中性底。
async function loadBoardUpload(key: string, load: (src: string) => Promise<HTMLImageElement>): Promise<HTMLImageElement | null> {
  const blob = await photoStore.getBlob(key).catch(() => undefined);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  try { return await load(url); } catch { return null; } finally { URL.revokeObjectURL(url); }
}

// 多跨页拼图导出：把内页跨页（spread）等宽缩放、竖向堆叠到内置装饰背景上，
// 输出小红书竖图 3:4（2160×2880 @2x）。density k∈{1,2,3} = 一张图放几个跨页，
// N 个内页跨页按 k 个一组 → ceil(N/k) 张。封面/封尾不进拼图（只导出内页）。

const OUT_W = 2160;
const OUT_H = 2880; // 3:4 竖图
const FACE_SCALE = 2; // 单 face 截图倍率（拼图里会再缩放，2 足够清晰）
const MARGIN_X = 220;
const MARGIN_Y = 210;
const GAP = 140; // 跨页之间竖向间距（@基准，未缩放）
const GAP_X = 90; // 多列布局(6=左三右三)的列间距
const SPREAD_AR = (PAGE.width * 2) / PAGE.height; // 跨页宽高比 ≈ 1.414

export interface CollageOptions {
  perImage: 1 | 2 | 3 | 6;
  background?: BoardBackground | null; // 相册垫底背景;与预览同源。null=中性底
  onProgress?: (done: number, total: number) => void; // done/total 按已渲染 face 计
  quality?: number; // JPEG 质量，默认 0.92
}

// 只取内页跨页：buildSpreads 里封面/封尾是 solo，滤掉即剩内页（含尾部落单的空白半页）。
export function interiorSpreads(pages: { templateId: string }[]): Spread[] {
  const asEditor = pages as unknown as EditorPage[];
  return buildSpreads(asEditor).filter((s) => !isSoloSpread(s, asEditor));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // 内置预设图是同源(/board-bg/*)，同源不会污染 canvas，无需 crossOrigin。
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('bg image load failed: ' + src));
    img.src = src;
  });
}

// 中性底(未选背景时)：一层柔和的竖向浅灰渐变，不喧宾夺主。
function paintNeutral(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createLinearGradient(0, 0, 0, OUT_H);
  g.addColorStop(0, '#eef1f3');
  g.addColorStop(1, '#f5f4f1');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, OUT_W, OUT_H);
}

// cover 铺满 OUT_W×OUT_H，居中裁切。
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement): void {
  const scale = Math.max(OUT_W / img.width, OUT_H / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (OUT_W - w) / 2, (OUT_H - h) / 2, w, h);
}

// 把一个跨页画到 (x,y,w,h)：白底页 + 软阴影 + 左右 face + 中缝。
function drawSpread(
  ctx: CanvasRenderingContext2D,
  left: HTMLCanvasElement | null,
  right: HTMLCanvasElement | null,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.shadowColor = 'rgba(30,40,60,0.22)';
  ctx.shadowBlur = 46;
  ctx.shadowOffsetY = 22;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const halfW = w / 2;
  if (left) ctx.drawImage(left, x, y, halfW, h);
  if (right) ctx.drawImage(right, x + halfW, y, halfW, h);

  // 中缝：一条极淡的分页线。
  ctx.strokeStyle = 'rgba(30,40,60,0.06)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + halfW, y);
  ctx.lineTo(x + halfW, y + h);
  ctx.stroke();
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
      'image/jpeg',
      quality,
    );
  });
}

export async function renderCollages(
  pages: (AdaptablePage & { html?: string })[],
  resolveImage: ResolveImage,
  options: CollageOptions,
): Promise<Blob[]> {
  await loadAlbumFonts(pages).catch(() => undefined);
  const quality = options.quality ?? 0.92;
  const spreads = interiorSpreads(pages);
  if (spreads.length === 0) return [];

  // 解析垫底背景一次(预设图先载好)。与预览同一来源。
  const bg = options.background ?? null;
  let bgImage: HTMLImageElement | null = null;
  if (bg?.kind === 'preset') {
    bgImage = await loadImage(presetImageUrl(bg.presetId)).catch(() => null);
  } else if (bg?.kind === 'upload') {
    bgImage = await loadBoardUpload(bg.key, loadImage);
  }
  const paintBackground = (ctx: CanvasRenderingContext2D) => {
    if (bg?.kind === 'color') { ctx.fillStyle = bg.color; ctx.fillRect(0, 0, OUT_W, OUT_H); }
    else if (bgImage) { drawCover(ctx, bgImage); }
    else { paintNeutral(ctx); } // 未选 / 预设图缺失 → 中性底
  };

  const folios = pageFolioNumbers(pages.map((p) => p.templateId));
  const folioSides = pageFolioSides(pages.map((p) => p.templateId));
  const total = pages.length;

  // face 渲染缓存 + 进度：以「需渲染的 face 数」为总量。
  const faceCache = new Map<number, HTMLCanvasElement>();
  const neededFaces = new Set<number>();
  for (const s of spreads) {
    if (s.left != null) neededFaces.add(s.left);
    if (s.right != null) neededFaces.add(s.right);
  }
  const totalFaces = neededFaces.size;
  let done = 0;
  async function face(idx: number | null): Promise<HTMLCanvasElement | null> {
    if (idx == null) return null;
    const cached = faceCache.get(idx);
    if (cached) return cached;
    const canvas = await renderFaceToCanvas(pages[idx]!, resolveImage, {
      scale: FACE_SCALE, total, folio: folios[idx] ?? null, folioSide: folioSides[idx] ?? 'right',
    });
    faceCache.set(idx, canvas);
    done += 1;
    options.onProgress?.(done, totalFaces);
    return canvas;
  }

  const groups = chunk(spreads, options.perImage);
  const blobs: Blob[] = [];
  for (const group of groups) {
    const out = document.createElement('canvas');
    out.width = OUT_W;
    out.height = OUT_H;
    const ctx = out.getContext('2d')!;
    paintBackground(ctx);

    // 布局：1/2/3 = 单列竖排；6 = 左三右三(2 列 × 3 行,列优先填充,不足则左右均衡)。
    // 网格超出可用区则整体等比缩小、居中。
    const k = group.length;
    const cols = options.perImage === 6 ? 2 : 1;
    const rows = cols === 2 ? Math.ceil(k / 2) : k;
    let gapX = GAP_X;
    let gapY = GAP;
    let cellW = (OUT_W - MARGIN_X * 2 - (cols - 1) * gapX) / cols;
    let cellH = cellW / SPREAD_AR;
    const availH = OUT_H - MARGIN_Y * 2;
    const contentH = rows * cellH + (rows - 1) * gapY;
    if (contentH > availH) {
      const f = availH / contentH;
      cellW *= f; cellH *= f; gapY *= f; gapX *= f;
    }
    const gridW = cols * cellW + (cols - 1) * gapX;
    const gridH = rows * cellH + (rows - 1) * gapY;
    const startX = (OUT_W - gridW) / 2;
    const startY = (OUT_H - gridH) / 2;

    for (let i = 0; i < group.length; i++) {
      const s = group[i]!;
      const col = Math.floor(i / rows); // 列优先:前 rows 个填左列,其余填右列
      const row = i % rows;
      const x = startX + col * (cellW + gapX);
      const y = startY + row * (cellH + gapY);
      const [l, r] = await Promise.all([face(s.left), face(s.right)]);
      drawSpread(ctx, l, r, x, y, cellW, cellH);
    }
    blobs.push(await canvasToJpegBlob(out, quality));
  }
  return blobs;
}
