import { isSpreadTemplate } from '@yujee/contracts/render';
import type { AdaptablePage, ResolveImage } from '@/components/album/adapt-layout';
import { pageFolioInfos } from '@/components/album/page-html-dom';
import { buildSpreads, isSoloSpread, spreadPageIndices } from '@/components/album/spreads';
import type { EditorPage } from '@/components/album/types';
import { PAGE } from '@/components/album/templates/constants';
import { loadAlbumFonts } from '@/lib/font/album-font-loader';
import { renderFaceToCanvas } from '@/lib/pdf/render-raster';
import { splitSpreadCanvas } from '@/lib/pdf/split-spread-canvas';

export type NineGridAspect = '9:16' | '3:4';
export type NineGridFrameStyle = 'full' | 'framed';
export type NineGridLayoutMode = 'single' | 'spread';

export interface NineGridMotionOptions {
  aspect: NineGridAspect;
  frameStyle: NineGridFrameStyle;
  background: string;
  duration: number;
  fps: number;
  onProgress?: (done: number, total: number) => void;
}

interface LoadedImage {
  source: HTMLImageElement;
  width: number;
  height: number;
}

const WIDTH = 1080;
const HEIGHTS: Record<NineGridAspect, number> = { '9:16': 1920, '3:4': 1440 };
const SWING_CYCLES = [4.65, 5.05, 4.8, 5.25, 4.7, 5.12, 4.9, 5.2, 4.75, 5, 4.85, 5.15];
const SWING_PHASES = [-0.16, 0.09, 0.2, -0.08, 0.13, -0.19, 0.05, 0.18, -0.12, 0.02, -0.06, 0.15];
const SWING_AMPLITUDES = [0.94, 1.05, 0.98, 1.08, 0.92, 1.02, 1, 0.96, 1.06, 0.95, 1.03, 0.99];
const LAYOUTS_PER_SCENE = 9;

export class NineGridUnsupportedError extends Error {
  constructor() {
    super('Canvas video recording is not supported in this browser');
    this.name = 'NineGridUnsupportedError';
  }
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const clampRatio = (value: number) => Math.max(0.45, Math.min(2.2, value || 1));
const easeOutBack = (value: number) => {
  const c1 = 1.18;
  return 1 + (c1 + 1) * Math.pow(value - 1, 3) + c1 * Math.pow(value - 1, 2);
};
const easeInOut = (value: number) => value < 0.5
  ? 4 * value * value * value
  : 1 - Math.pow(-2 * value + 2, 3) / 2;

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function loadImage(src: string): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('nine-grid image load failed'));
    image.src = src;
  });
}

function canvasSource(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/jpeg', 0.9);
}

function pairCanvas(
  left: HTMLCanvasElement | null,
  right: HTMLCanvasElement | null,
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = PAGE.width * 2;
  out.height = PAGE.height;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('2d canvas is unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  if (left) ctx.drawImage(left, 0, 0, PAGE.width, PAGE.height);
  if (right) ctx.drawImage(right, PAGE.width, 0, PAGE.width, PAGE.height);
  return out;
}

/**
 * 把网站当前的真实排版离屏截图成九宫格素材。
 * single = 逐个物理单页（双宽模板拆左右页）；spread = 按画板的单页封面/跨页/封底组合。
 */
export async function renderNineGridLayoutSources(
  pages: (AdaptablePage & { html?: string })[],
  resolveImage: ResolveImage,
  mode: NineGridLayoutMode,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  await loadAlbumFonts(pages).catch(() => undefined);
  const total = pages.length;
  const folios = pageFolioInfos(pages.map((page) => page.templateId));
  const faceCache = new Map<number, HTMLCanvasElement>();

  async function face(index: number): Promise<HTMLCanvasElement> {
    const cached = faceCache.get(index);
    if (cached) return cached;
    const canvas = await renderFaceToCanvas(pages[index]!, resolveImage, {
      scale: 1,
      total,
      folio: folios[index]?.folio ?? null,
      folioSide: folios[index]?.side ?? 'right',
    });
    faceCache.set(index, canvas);
    return canvas;
  }

  const sources: string[] = [];
  if (mode === 'single') {
    const workTotal = pages.reduce(
      (count, page) => count + (isSpreadTemplate(page.templateId) ? 2 : 1),
      0,
    );
    for (let index = 0; index < pages.length; index += 1) {
      const canvas = await face(index);
      const physicalPages = isSpreadTemplate(pages[index]!.templateId)
        ? splitSpreadCanvas(canvas)
        : [canvas];
      for (const physicalPage of physicalPages) {
        sources.push(canvasSource(physicalPage));
        onProgress?.(sources.length, workTotal);
      }
    }
    return sources;
  }

  const editorPages = pages as unknown as EditorPage[];
  const spreads = buildSpreads(editorPages);
  for (let index = 0; index < spreads.length; index += 1) {
    const spread = spreads[index]!;
    if (spread.kind === 'full') {
      sources.push(canvasSource(await face(spread.page)));
    } else if (isSoloSpread(spread, editorPages)) {
      const pageIndex = spreadPageIndices(spread)[0]!;
      sources.push(canvasSource(await face(pageIndex)));
    } else {
      const [left, right] = await Promise.all([
        spread.left == null ? null : face(spread.left),
        spread.right == null ? null : face(spread.right),
      ]);
      sources.push(canvasSource(pairCanvas(left, right)));
    }
    onProgress?.(index + 1, spreads.length);
  }
  return sources;
}

function drawPin(ctx: CanvasRenderingContext2D, y: number) {
  ctx.save();
  ctx.fillStyle = 'rgba(66,54,37,.2)';
  ctx.beginPath();
  ctx.ellipse(3, y + 7, 13, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  const gradient = ctx.createRadialGradient(-5, y - 6, 1, 0, y, 15);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.35, '#f8f4e8');
  gradient.addColorStop(0.76, '#e2dac8');
  gradient.addColorStop(1, '#a99d86');
  ctx.fillStyle = gradient;
  ctx.strokeStyle = 'rgba(111,97,76,.42)';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.arc(0, y, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.82)';
  ctx.beginPath();
  ctx.ellipse(-5, y - 6, 4.2, 2.8, -0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  image: LoadedImage,
  x: number,
  y: number,
  width: number,
  height: number,
  opacity: number,
  scale: number,
  swing: number,
) {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(x, y - height / 2 + 4);
  ctx.rotate(swing);
  ctx.scale(scale, scale);
  ctx.translate(0, height / 2 - 4);
  ctx.shadowColor = 'rgba(46,39,29,.22)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#f2efe7';
  roundedRect(ctx, -width / 2, -height / 2, width, height, 4);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  const fit = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * fit;
  const drawHeight = image.height * fit;
  ctx.save();
  roundedRect(ctx, -width / 2, -height / 2, width, height, 4);
  ctx.clip();
  ctx.drawImage(image.source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  ctx.restore();
  drawPin(ctx, -height / 2 + 4);
  ctx.restore();
}

function fitCardSize(
  image: LoadedImage,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const ratio = clampRatio(image.width / image.height);
  let width = maxWidth;
  let height = width / ratio;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * ratio;
  }
  return { width, height };
}

export async function renderNineGridCover(
  imageSources: string[],
  background = '#c9c5b9',
): Promise<Blob> {
  const images = await Promise.all(imageSources.slice(0, LAYOUTS_PER_SCENE).map(loadImage));
  if (images.length === 0) throw new Error('no layouts to render');
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHTS['3:4'];
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas is unavailable');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const columns = 3;
  const rows = Math.ceil(images.length / columns);
  const gapX = 20;
  const gapY = 22;
  const cellWidth = 286;
  const cellHeight = 352;
  const gridWidth = columns * cellWidth + (columns - 1) * gapX;
  const gridHeight = rows * cellHeight + (rows - 1) * gapY;
  const startX = (canvas.width - gridWidth) / 2;
  const startY = (canvas.height - gridHeight) / 2;

  images.forEach((image, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const card = fitCardSize(image, cellWidth, cellHeight);
    drawCard(
      ctx,
      image,
      startX + column * (cellWidth + gapX) + cellWidth / 2,
      startY + row * (cellHeight + gapY) + cellHeight / 2,
      card.width,
      card.height,
      1,
      1,
      0,
    );
  });

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('cover canvas.toBlob returned null'))),
      'image/jpeg',
      0.92,
    );
  });
}

function renderFrame(
  canvas: HTMLCanvasElement,
  images: LoadedImage[],
  seconds: number,
  options: NineGridMotionOptions,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas is unavailable');
  const height = HEIGHTS[options.aspect];
  const count = images.length;
  ctx.clearRect(0, 0, WIDTH, height);
  if (options.frameStyle === 'framed') {
    ctx.fillStyle = '#f6f5f1';
    ctx.fillRect(0, 0, WIDTH, height);
  }
  ctx.save();
  if (options.frameStyle === 'framed') {
    roundedRect(ctx, 36, 38, WIDTH - 72, height - 76, 42);
    ctx.clip();
  }
  const frameX = options.frameStyle === 'framed' ? 36 : 0;
  const frameY = options.frameStyle === 'framed' ? 38 : 0;
  const frameWidth = options.frameStyle === 'framed' ? WIDTH - 72 : WIDTH;
  const frameHeight = options.frameStyle === 'framed' ? height - 76 : height;
  ctx.fillStyle = options.background;
  ctx.fillRect(frameX, frameY, frameWidth, frameHeight);
  const vignette = ctx.createLinearGradient(0, 0, 0, height);
  vignette.addColorStop(0, 'rgba(255,255,255,.2)');
  vignette.addColorStop(0.7, 'rgba(255,255,255,0)');
  vignette.addColorStop(1, 'rgba(60,52,40,.09)');
  ctx.fillStyle = vignette;
  ctx.fillRect(frameX, frameY, frameWidth, frameHeight);
  if (!count) {
    ctx.restore();
    return;
  }

  const columns = count <= 2 ? count : count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / columns);
  const gapX = 20;
  const gapY = 22;
  const availableWidth = options.frameStyle === 'framed'
    ? (columns === 3 ? 780 : columns === 2 ? 820 : 560)
    : (columns === 3 ? 880 : columns === 2 ? 906 : 734);
  const availableHeight = height * (options.frameStyle === 'framed' ? 0.6875 : 0.792);
  const cellWidth = (availableWidth - gapX * (columns - 1)) / columns;
  const cellHeight = (availableHeight - gapY * (rows - 1)) / rows;
  const gridWidth = columns * cellWidth + (columns - 1) * gapX;
  const gridHeight = rows * cellHeight + (rows - 1) * gapY;
  const originX = (WIDTH - gridWidth) / 2;
  const originY = (height - gridHeight) / 2;
  const localEnter = Math.min(0.1, options.duration * 0.03);
  const localExit = Math.min(0.09, options.duration * 0.025);
  const enterSpan = options.duration * 0.31;
  const exitStart = options.duration * 0.65;
  const enterStagger = count > 1 ? (enterSpan - localEnter) / (count - 1) : 0;
  const exitStagger = count > 1 ? (options.duration - exitStart - localExit) / (count - 1) : 0;
  const groupAge = seconds - (count - 1) * enterStagger;
  const groupDuration = options.duration - (count - 1) * enterStagger;
  const groupProgress = clamp01(groupAge / groupDuration);
  const groupActive = groupAge >= 0 && groupAge < groupDuration;

  images.forEach((image, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const x = originX + column * (cellWidth + gapX) + cellWidth / 2;
    const y = originY + row * (cellHeight + gapY) + cellHeight / 2;
    const card = fitCardSize(image, cellWidth, cellHeight);
    const enter = clamp01((seconds - index * enterStagger) / localEnter);
    const exit = clamp01((seconds - exitStart - index * exitStagger) / localExit);
    const opacity = easeInOut(enter) * (1 - easeInOut(exit));
    if (opacity <= 0.001) return;
    const scale = (0.94 + 0.06 * easeOutBack(enter)) * (1 - 0.04 * easeInOut(exit));
    const swingAge = seconds - index * enterStagger;
    const localSwing = swingAge >= 0 && swingAge < 1
      ? (index % 2 === 0 ? 1 : -1) * 0.09 * Math.exp(-5 * swingAge) * Math.cos(18 * swingAge)
      : 0;
    const groupSwing = 0.058
      * SWING_AMPLITUDES[index % SWING_AMPLITUDES.length]!
      * (1 - 0.25 * groupProgress)
      * Math.cos(
        groupProgress * Math.PI * 2 * SWING_CYCLES[index % SWING_CYCLES.length]!
        + SWING_PHASES[index % SWING_PHASES.length]!,
      );
    drawCard(ctx, image, x, y, card.width, card.height, opacity, scale, groupActive ? groupSwing : localSwing);
  });
  ctx.restore();
}

export async function renderNineGridVideo(
  imageSources: string[],
  partial: Partial<NineGridMotionOptions> = {},
): Promise<Blob> {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
    throw new NineGridUnsupportedError();
  }
  const options: NineGridMotionOptions = {
    aspect: '3:4',
    frameStyle: 'full',
    background: '#c9c5b9',
    duration: 4.4,
    fps: 30,
    ...partial,
  };
  const images = await Promise.all(imageSources.map(loadImage));
  if (images.length === 0) throw new Error('no photos to render');
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHTS[options.aspect];
  const stream = canvas.captureStream?.(options.fps);
  if (!stream) throw new NineGridUnsupportedError();
  const mimeType = [
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm',
  ].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) {
    stream.getTracks().forEach((track) => track.stop());
    throw new NineGridUnsupportedError();
  }
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10_000_000 });
  const chunks: BlobPart[] = [];
  return new Promise((resolve, reject) => {
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => reject(new Error('nine-grid video recording failed'));
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      resolve(new Blob(chunks, { type: mimeType }));
    };
    recorder.start(100);
    const startedAt = performance.now();
    const sceneCount = Math.ceil(images.length / LAYOUTS_PER_SCENE);
    const totalDuration = sceneCount * options.duration;
    const totalFrames = Math.ceil(totalDuration * options.fps);
    const tick = (now: number) => {
      const seconds = Math.min(totalDuration, (now - startedAt) / 1000);
      const sceneIndex = Math.min(sceneCount - 1, Math.floor(seconds / options.duration));
      const sceneSeconds = sceneIndex === sceneCount - 1 && seconds === totalDuration
        ? options.duration
        : seconds - sceneIndex * options.duration;
      const sceneImages = images.slice(
        sceneIndex * LAYOUTS_PER_SCENE,
        (sceneIndex + 1) * LAYOUTS_PER_SCENE,
      );
      renderFrame(canvas, sceneImages, sceneSeconds, options);
      options.onProgress?.(Math.min(totalFrames, Math.round(seconds * options.fps)), totalFrames);
      if (seconds < totalDuration) requestAnimationFrame(tick);
      else setTimeout(() => recorder.stop(), 120);
    };
    requestAnimationFrame(tick);
  });
}
