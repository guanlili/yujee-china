'use client';

export type CompressedPhoto = {
  photoId: string;
  base64: string;
  width: number;
  height: number;
};

// Accepts a Blob (File is a Blob) so we can re-compress originals read back from
// IndexedDB — the resume-after-purchase and failed-album retry flows rebuild the
// 800px base64 from the stored original instead of persisting the base64 itself.
export async function compressFile(file: Blob, photoId: string): Promise<CompressedPhoto> {
  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);
  const { canvas, w, h } = drawScaled(img, 800);
  const base64 = canvas.toDataURL('image/jpeg', 0.6);
  return { photoId, base64, width: w, height: h };
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawScaled(img: HTMLImageElement, maxLen: number) {
  const scale = Math.min(1, maxLen / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, w, h };
}
