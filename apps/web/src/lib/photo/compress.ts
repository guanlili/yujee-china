'use client';

export type CompressedPhoto = {
  photoId: string;
  base64: string;
  width: number;
  height: number;
};

export async function compressFile(file: File, photoId: string): Promise<CompressedPhoto> {
  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);
  const { canvas, w, h } = drawScaled(img, 800);
  const base64 = canvas.toDataURL('image/jpeg', 0.6);
  return { photoId, base64, width: w, height: h };
}

function readAsDataUrl(file: File): Promise<string> {
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
