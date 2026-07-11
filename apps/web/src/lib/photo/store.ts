'use client';

import { prepareImageBlobForBrowserDecode } from './heic';

// Original photos live only in the browser (architecture invariant 1). They are
// kept in IndexedDB keyed by a globally-unique photoId so the editor and PDF
// export can read full-resolution originals without ever re-uploading them.

const DB_NAME = 'yujee-photos';
const STORE = 'originals';
const VERSION = 1;

export const PDF_IMAGE_MAX_EDGE = 1600;
// 栅格 PDF（html2canvas 高倍截图）用：满页图槽在 scale 3 下要 ~3369px 长边，故喂到 3400。
export const RASTER_PDF_IMAGE_MAX_EDGE = 3400;
const PDF_IMAGE_QUALITY = 0.82;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return openDb().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function asPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const urlCache = new Map<string, string>();

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

export function fitWithinMaxEdge(
  width: number,
  height: number,
  maxEdge = PDF_IMAGE_MAX_EDGE,
): { w: number; h: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale)),
  };
}

type DecodedImage = CanvasImageSource & {
  width: number;
  height: number;
  close?: () => void;
};

function loadImageFromObjectUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Browser could not decode stored photo image.'));
    img.src = url;
  });
}

async function decodeBlob(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      // Some older engines reject ImageBitmapOptions; the <img> fallback still
      // applies EXIF orientation and keeps export usable.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await loadImageFromObjectUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function blobToPdfDataUrl(blob: Blob, maxEdge = PDF_IMAGE_MAX_EDGE): Promise<string> {
  const pdfBlob = await prepareImageBlobForBrowserDecode(blob);
  const img = await decodeBlob(pdfBlob);
  let canvas: HTMLCanvasElement | null = null;
  try {
    const { w, h } = fitWithinMaxEdge(img.width, img.height, maxEdge);
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('PDF image canvas context unavailable');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', PDF_IMAGE_QUALITY);
  } finally {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    img.close?.();
  }
}

// Safari/WebKit cannot reliably store file-backed File/Blob objects (as handed
// out by <input type=file>, especially iOS photo-library temp copies) in
// IndexedDB: the transaction commit re-reads the source file and can throw
// UnknownError "Error preparing Blob/File data to be stored in object store".
// Reading the bytes into memory first and storing a memory-backed copy avoids
// the file reference entirely. `name` is preserved because HEIC sniffing on
// read-back falls back to the filename when the MIME type is empty (heic.ts).
async function toMemoryBackedBlob(blob: Blob): Promise<Blob> {
  const bytes = await blob.arrayBuffer();
  const name = (blob as File).name;
  return typeof name === 'string' && name
    ? new File([bytes], name, { type: blob.type })
    : new Blob([bytes], { type: blob.type });
}

export const photoStore = {
  async put(photoId: string, blob: Blob): Promise<void> {
    const copy = await toMemoryBackedBlob(blob);
    const store = await tx('readwrite');
    await asPromise(store.put(copy, photoId));
  },

  async putMany(items: { photoId: string; blob: Blob }[]): Promise<void> {
    const copies = await Promise.all(items.map((it) => toMemoryBackedBlob(it.blob)));
    const store = await tx('readwrite');
    await Promise.all(copies.map((copy, i) => asPromise(store.put(copy, items[i].photoId))));
  },

  async getBlob(photoId: string): Promise<Blob | undefined> {
    const store = await tx('readonly');
    const result = await asPromise(store.get(photoId));
    return (result as Blob | undefined) ?? undefined;
  },

  // Cached blob: URL — cheap to hand to <img> for the on-screen preview.
  async getObjectUrl(photoId: string): Promise<string | undefined> {
    const cached = urlCache.get(photoId);
    if (cached) return cached;
    const blob = await this.getBlob(photoId);
    if (!blob) return undefined;
    const displayBlob = await prepareImageBlobForBrowserDecode(blob);
    const url = URL.createObjectURL(displayBlob);
    urlCache.set(photoId, url);
    return url;
  },

  async getObjectUrls(photoIds: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    await Promise.all(
      photoIds.map(async (id) => {
        const url = await this.getObjectUrl(id);
        if (url) out[id] = url;
      }),
    );
    return out;
  },

  // Data URL — the PDF export pipeline needs fetchable/data URLs (blob: URLs
  // are unreliable inside detached render surfaces), so it resolves to these.
  async getDataUrls(photoIds: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    await Promise.all(
      photoIds.map(async (id) => {
        const blob = await this.getBlob(id);
        if (blob) {
          const dataBlob = await prepareImageBlobForBrowserDecode(blob);
          out[id] = await blobToDataUrl(dataBlob);
        }
      }),
    );
    return out;
  },

  // PDF export is memory-bound in the browser: never hand original phone-photo
  // data URLs. Decode from Blob, cap size locally, and process photos sequentially
  // so peak memory stays bounded before the PDF is assembled.
  // maxEdge：栅格导出（html2canvas 高倍截图）传 RASTER_PDF_IMAGE_MAX_EDGE，
  // 否则源图被降到默认 1600 后放大 3-4 倍会糊。
  async getPdfDataUrls(
    photoIds: string[],
    maxEdge = PDF_IMAGE_MAX_EDGE,
  ): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const id of photoIds) {
      const blob = await this.getBlob(id);
      if (blob) out[id] = await blobToPdfDataUrl(blob, maxEdge);
    }
    return out;
  },

  revokeAll(): void {
    for (const url of urlCache.values()) URL.revokeObjectURL(url);
    urlCache.clear();
  },
};
