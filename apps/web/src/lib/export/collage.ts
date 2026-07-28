import type { AdaptablePage, ResolveImage } from '@/components/album/adapt-layout';
import { pageFolioInfos } from '@/components/album/page-html-dom';
import { buildSpreads, isSoloSpread, spreadPageIndices, type Spread } from '@/components/album/spreads';
import type { EditorPage } from '@/components/album/types';
import { PAGE } from '@/components/album/templates/constants';
import { loadAlbumFonts } from '@/lib/font/album-font-loader';
import { renderFaceToCanvas } from '@/lib/pdf/render-raster';
import { type BoardBackground } from '@/lib/board-bg/presets';
// 垫底背景的画法与 Live 导出共用一份(见该模块抬头:三处必须是同一个底)。
import { resolveBoardBgPainter } from './board-bg-canvas';

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

// 把一个跨页画到 (x,y,w,h)：白底页 + 软阴影 + 左右 face + 中缝。
function drawSpreadBase(
  ctx: CanvasRenderingContext2D,
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
}

// 左右两半 face + 中缝。
function drawPairSpread(
  ctx: CanvasRenderingContext2D,
  left: HTMLCanvasElement | null,
  right: HTMLCanvasElement | null,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  drawSpreadBase(ctx, x, y, w, h);
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

// 双宽(#303)页：一整张双宽 face 铺满整格，没有中缝可画（画面是连续的）。
function drawFullSpread(
  ctx: CanvasRenderingContext2D,
  face: HTMLCanvasElement | null,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  drawSpreadBase(ctx, x, y, w, h);
  if (face) ctx.drawImage(face, x, y, w, h);
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

  // 解析垫底背景一次(预设图先载好)。与预览、Live 导出同一来源、同一画法。
  const paintBoardBg = await resolveBoardBgPainter(options.background);
  const paintBackground = (ctx: CanvasRenderingContext2D) => paintBoardBg(ctx, 0, 0, OUT_W, OUT_H);

  const folioInfos = pageFolioInfos(pages.map((p) => p.templateId));
  const total = pages.length;

  // face 渲染缓存 + 进度：以「需渲染的 face 数」为总量。
  const faceCache = new Map<number, HTMLCanvasElement>();
  const neededFaces = new Set<number>();
  for (const s of spreads) for (const idx of spreadPageIndices(s)) neededFaces.add(idx);
  const totalFaces = neededFaces.size;
  let done = 0;
  async function face(idx: number | null): Promise<HTMLCanvasElement | null> {
    if (idx == null) return null;
    const cached = faceCache.get(idx);
    if (cached) return cached;
    const canvas = await renderFaceToCanvas(pages[idx]!, resolveImage, {
      scale: FACE_SCALE, total,
      folio: folioInfos[idx]?.folio ?? null,
      folioSide: folioInfos[idx]?.side ?? 'right',
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
      if (s.kind === 'full') {
        // 双宽页占满整格：一张 face 铺满，不切两半、不画中缝。
        drawFullSpread(ctx, await face(s.page), x, y, cellW, cellH);
      } else {
        const [l, r] = await Promise.all([face(s.left), face(s.right)]);
        drawPairSpread(ctx, l, r, x, y, cellW, cellH);
      }
    }
    blobs.push(await canvasToJpegBlob(out, quality));
  }
  return blobs;
}
