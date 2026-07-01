'use client';

export type HeicConverter = (file: Blob) => Promise<Blob>;

export const IMAGE_INPUT_ACCEPT = 'image/*,.heic,.heif,image/heic,image/heif,image/heic-sequence,image/heif-sequence';

export async function prepareImageBlobForBrowserDecode(
  file: Blob,
  heicConverter: HeicConverter = defaultHeicConverter,
): Promise<Blob> {
  if (!isHeicOrHeif(file)) return file;

  try {
    const converted = await heicConverter(file);
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

async function defaultHeicConverter(file: Blob): Promise<Blob> {
  const { default: heic2any } = await import('heic2any');
  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
  const first = Array.isArray(converted) ? converted[0] : converted;
  if (!first) throw new Error('HEIC conversion returned no image.');
  return first;
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
