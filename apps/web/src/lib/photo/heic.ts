'use client';

export type HeicConverter = (file: Blob) => Promise<Blob>;

export const IMAGE_INPUT_ACCEPT = 'image/*,.heic,.heif,image/heic,image/heif,image/heic-sequence,image/heif-sequence';

// 单文件转换硬超时:解码 wasm 对个别文件可能永不 resolve(heic2any 时代 10-bit
// HEIC 就是这样挂死整批照片的)。超时按错误处理 → 调用方跳过该文件,批次继续。
export const HEIC_CONVERT_TIMEOUT_MS = 30_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`HEIC conversion timed out after ${Math.round(ms / 1000)}s.`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export async function prepareImageBlobForBrowserDecode(
  file: Blob,
  heicConverter: HeicConverter = defaultHeicConverter,
  timeoutMs: number = HEIC_CONVERT_TIMEOUT_MS,
): Promise<Blob> {
  if (!isHeicOrHeif(file)) return file;

  try {
    const converted = await withTimeout(heicConverter(file), timeoutMs);
    if (!(converted instanceof Blob)) {
      throw new Error('HEIC conversion returned a non-image result.');
    }
    return converted;
  } catch (cause) {
    const message = describeUnknownError(cause);
    const err = new Error(
      message
        ? `Browser could not convert this HEIC/HEIF image for browser processing. ${message}`
        : 'Browser could not convert this HEIC/HEIF image for browser processing.',
    );
    (err as Error & { cause?: unknown }).cause = cause;
    throw err;
  }
}

// heic-to(维护中的 libheif wasm)替代 heic2any:heic2any 0.0.4 的 2019 版
// libheif 解不了 iPhone 14+/iOS 16+ 默认的 10-bit(HEVC Main 10)HEIC,且失败
// 形态是永久挂起而非报错。'heic-to/next' 是其适配 Next 打包的构建。
async function defaultHeicConverter(file: Blob): Promise<Blob> {
  const { heicTo } = await import('heic-to/next');
  const converted = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
  if (!converted) throw new Error('HEIC conversion returned no image.');
  return converted;
}

const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);

function isHeicOrHeif(file: Blob): boolean {
  const type = file.type.toLowerCase();
  if (HEIC_TYPES.has(type)) return true;

  const name = (file as { name?: unknown }).name;
  if (typeof name !== 'string') return false;
  const lowerName = name.toLowerCase();
  return lowerName.endsWith('.heic') || lowerName.endsWith('.heif');
}

function describeUnknownError(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === 'string') return cause;
  if (typeof Event !== 'undefined' && cause instanceof Event) {
    return cause.type ? `Browser image event: ${cause.type}.` : 'Browser image event.';
  }
  if (
    cause &&
    typeof cause === 'object' &&
    'message' in cause &&
    typeof (cause as { message?: unknown }).message === 'string'
  ) {
    return (cause as { message: string }).message;
  }
  return '';
}
