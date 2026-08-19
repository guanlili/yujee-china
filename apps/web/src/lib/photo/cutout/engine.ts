// 抠图引擎:Blob -> 带 alpha 的 WebP。算法在 cutout-math.ts,这里只负责
// 解码 / 取像素 / 写回 / 编码,与 lut/engine.ts 同一分层。
//
// **抠不动就原样退回原图**,绝不抛给调用方:抠图是锦上添花,拿不到画布或解码失败
// 时用户应当看到原照片,而不是一个报错或者空白。
//
// 产物用 WebP 不用 PNG:抠图结果带 alpha,JPEG 装不下;而 3400px 的抠图 PNG
// 动辄 5-15MB,WebP 与 JPEG 同量级(这条口径与 photo-snapshot-util 的 snapshotExt 一致)。

import { buildAlphaMask, featherMask, type CutoutOptions } from './cutout-math';

const OUTPUT_TYPE = 'image/webp';
const OUTPUT_QUALITY = 0.9;
const DEFAULT_TOLERANCE = 32;
const DEFAULT_FEATHER = 1;

interface CutoutBitmap {
  readonly width: number;
  readonly height: number;
  close(): void;
}

interface CutoutCanvas {
  width: number;
  height: number;
  drawImage(bitmap: CutoutBitmap): void;
  getImageData(): { data: Uint8ClampedArray; width: number; height: number };
  putImageData(image: { data: Uint8ClampedArray; width: number; height: number }): void;
  encode(type: string, quality: number): Promise<Blob>;
  dispose(): void;
}

interface CutoutEngineDependencies {
  createCanvas: () => CutoutCanvas | null;
  decodeBlob: (blob: Blob) => Promise<CutoutBitmap>;
  logger: { warn(message?: unknown, ...rest: unknown[]): void };
}

export interface CutoutEngine {
  applyToBlob(original: Blob, opts?: Partial<CutoutOptions & { feather: number }>): Promise<Blob>;
}

function createCutoutEngine(deps: CutoutEngineDependencies): CutoutEngine {
  return {
    async applyToBlob(original, opts) {
      const canvas = deps.createCanvas();
      if (!canvas) {
        deps.logger.warn('cutout: no canvas available; returning original');
        return original;
      }
      try {
        const bitmap = await deps.decodeBlob(original);
        try {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.drawImage(bitmap);
          const image = canvas.getImageData();

          const mask = featherMask(
            buildAlphaMask(image.data, image.width, image.height, {
              tolerance: opts?.tolerance ?? DEFAULT_TOLERANCE,
              ...(opts?.minBorderShare !== undefined && { minBorderShare: opts.minBorderShare }),
            }),
            image.width,
            image.height,
            opts?.feather ?? DEFAULT_FEATHER,
          );

          for (let i = 0; i < mask.length; i += 1) image.data[i * 4 + 3] = mask[i]!;
          canvas.putImageData(image);
          return await canvas.encode(OUTPUT_TYPE, OUTPUT_QUALITY);
        } finally {
          bitmap.close();
        }
      } catch (error) {
        deps.logger.warn('cutout: failed; returning original', error);
        return original;
      } finally {
        canvas.dispose();
      }
    },
  };
}

function createCanvasAdapter(): CutoutCanvas | null {
  if (typeof document === 'undefined') return null;
  const el = document.createElement('canvas');
  const ctx = el.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  return {
    get width() { return el.width; },
    set width(v: number) { el.width = v; },
    get height() { return el.height; },
    set height(v: number) { el.height = v; },
    drawImage(bitmap) { ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0); },
    getImageData() { return ctx.getImageData(0, 0, el.width, el.height); },
    putImageData(image) { ctx.putImageData(image as ImageData, 0, 0); },
    encode(type, quality) {
      return new Promise<Blob>((resolve, reject) => {
        el.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))), type, quality);
      });
    },
    dispose() { el.width = 0; el.height = 0; },
  };
}

async function defaultDecodeBlob(blob: Blob): Promise<CutoutBitmap> {
  return createImageBitmap(blob) as unknown as Promise<CutoutBitmap>;
}

const defaultDependencies: CutoutEngineDependencies = {
  createCanvas: createCanvasAdapter,
  decodeBlob: defaultDecodeBlob,
  logger: console,
};

export const cutoutEngine: CutoutEngine = createCutoutEngine(defaultDependencies);

/** 供 node:test 用的窄缝:换掉浏览器适配器就能在没有 DOM 的环境里跑。 */
export function createCutoutEngineForTesting(
  overrides: Partial<CutoutEngineDependencies>,
): CutoutEngine {
  return createCutoutEngine({ ...defaultDependencies, ...overrides });
}
