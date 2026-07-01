'use client';

import { prepareImageBlobForBrowserDecode } from './heic';

export const COVER_THUMBNAIL_WIDTH = 640;
export const COVER_THUMBNAIL_HEIGHT = 480;
export const COVER_THUMBNAIL_CONTENT_TYPE = 'image/jpeg';
export const COVER_THUMBNAIL_MAX_BYTES = 512 * 1024;

const JPEG_QUALITIES = [0.82, 0.72, 0.62, 0.52];

type DecodedImage = CanvasImageSource & {
  width: number;
  height: number;
  close?: () => void;
};

function loadImageFromObjectUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Browser could not decode cover thumbnail image.'));
    img.src = url;
  });
}

async function decodeBlob(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      // Keep the fallback for browsers whose ImageBitmapOptions support lags.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await loadImageFromObjectUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('cover thumbnail JPEG encode failed'));
          return;
        }
        resolve(blob);
      },
      COVER_THUMBNAIL_CONTENT_TYPE,
      quality,
    );
  });
}

function coverCropSource(width: number, height: number) {
  const targetRatio = COVER_THUMBNAIL_WIDTH / COVER_THUMBNAIL_HEIGHT;
  const sourceRatio = width / height;
  if (sourceRatio > targetRatio) {
    const sw = height * targetRatio;
    return { sx: (width - sw) / 2, sy: 0, sw, sh: height };
  }
  const sh = width / targetRatio;
  return { sx: 0, sy: (height - sh) / 2, sw: width, sh };
}

export async function createCoverThumbnailJpeg(blob: Blob): Promise<Blob> {
  const imageBlob = await prepareImageBlobForBrowserDecode(blob);
  const img = await decodeBlob(imageBlob);
  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = document.createElement('canvas');
    canvas.width = COVER_THUMBNAIL_WIDTH;
    canvas.height = COVER_THUMBNAIL_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('cover thumbnail canvas context unavailable');

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, COVER_THUMBNAIL_WIDTH, COVER_THUMBNAIL_HEIGHT);
    const crop = coverCropSource(img.width, img.height);
    ctx.drawImage(
      img,
      crop.sx,
      crop.sy,
      crop.sw,
      crop.sh,
      0,
      0,
      COVER_THUMBNAIL_WIDTH,
      COVER_THUMBNAIL_HEIGHT,
    );

    let lastBlob: Blob | null = null;
    for (const quality of JPEG_QUALITIES) {
      const jpeg = await canvasToJpeg(canvas, quality);
      if (jpeg.size <= COVER_THUMBNAIL_MAX_BYTES) return jpeg;
      lastBlob = jpeg;
    }
    throw new Error(
      `cover thumbnail exceeds ${COVER_THUMBNAIL_MAX_BYTES} bytes after compression (${lastBlob?.size ?? 0})`,
    );
  } finally {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    img.close?.();
  }
}
