'use client';

import { prepareImageBlobForBrowserDecode } from './heic';
import {
  LutIdSchema,
  quantizeStrength,
  resolveEffectiveFilter,
  type PhotoFilterRef,
  type PhotoFilterState,
} from './filter-state';
import { lutEngine } from './lut/engine';

// Original photos live only in the browser (architecture invariant 1). They are
// kept in IndexedDB keyed by a globally-unique photoId so the editor and PDF
// export can read full-resolution originals without ever re-uploading them.
// 放宽范围(photo-snapshot-design.md):**原图仍永不上传**;仅当用户主动点「保存」时,
// 才把 display 档压缩派生图(getTierBlob)opt-in 直传 R2,用于换设备/清缓存后查看。

const DB_NAME = 'yujee-photos';
const STORE = 'originals';
// 派生尺寸缓存(v2):按 `${photoId}@${tier}` 存降采样 JPEG。屏显永远不解码原图
// (性能:20+ 页相册全用原图渲染会把解码/GPU 内存顶到 GB 级),原图只留给 PDF 导出。
const DERIVED_STORE = 'derived';
const VERSION = 2;

export const PDF_IMAGE_MAX_EDGE = 1600;
// 栅格 PDF（html2canvas 高倍截图）用：满页图槽在 scale 3 下要 ~3369px 长边，故喂到 3400。
export const RASTER_PDF_IMAGE_MAX_EDGE = 3400;
const PDF_IMAGE_QUALITY = 0.82;

// 屏显派生分级:thumb 给缩略图条/总览格(几十 px 显示),display 给主画布/翻页叶
// (页面上图槽最大 ~794px,1600 留了 2x 余量)。
//
// backup 是**上传档**,不是屏显档:它只在用户点「保存到云端」时生成一次,直传 R2。
// 尺寸对齐 RASTER_PDF_IMAGE_MAX_EDGE(3400)—— 换设备之后导出要拿它当源图,而满页
// 图槽在 scale 3 下要 ~3369px;早先备份传的是 1600 的 display 档,填进 3369 的槽等于
// 放大 2.1 倍,导出必糊。一张手机照片按这一档大约 1–2MB(display 档约 0.2–0.4MB)。
export type PhotoTier = 'thumb' | 'display' | 'backup';
export const TIER_MAX_EDGE: Record<PhotoTier, number> = { thumb: 240, display: 1600, backup: 3400 };
const TIER_QUALITY: Record<PhotoTier, number> = { thumb: 0.75, display: 0.82, backup: 0.82 };
/** 只生成一次就直传走的档位不进本地派生缓存 —— 3400 的 JPEG 一张 1–2MB,
 *  一本 100 张的书会白吃 100+MB IndexedDB,而它在本机没有任何渲染用途。 */
const UNCACHED_TIERS: ReadonlySet<PhotoTier> = new Set<PhotoTier>(['backup']);
const FILTERED_VARIANT_LIMIT = 2;

const SIMPLE_PHOTO_ID = /^[A-Za-z0-9_-]+$/;

function filteredPhotoNamespace(photoId: string): string {
  // Preserve planned readable keys for normal UUID/opaque ids. Unsafe ids use
  // an injective length-prefixed namespace whose leading "~" cannot collide
  // with the simple branch.
  return SIMPLE_PHOTO_ID.test(photoId) ? photoId : `~${photoId.length}:${photoId}`;
}

export function filteredVariantPrefix(photoId: string, tier: PhotoTier): string {
  return `${filteredPhotoNamespace(photoId)}@${tier}@pf-v1@`;
}

export function derivedCacheKey(
  photoId: string,
  tier: PhotoTier,
  ref: PhotoFilterRef | null | undefined,
): string {
  const strength = ref ? quantizeStrength(ref.strength) : 0;
  if (!ref || strength <= 0) return `${photoId}@${tier}`;
  return `${filteredVariantPrefix(photoId, tier)}${ref.lutId}@${strength}`;
}

function effectiveFilter(
  state: PhotoFilterState | null | undefined,
  photoId: string,
): PhotoFilterRef | null {
  const ref = resolveEffectiveFilter(state, photoId);
  if (!ref) return null;
  const strength = quantizeStrength(ref.strength);
  return strength > 0 ? { ...ref, strength } : null;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(DERIVED_STORE)) db.createObjectStore(DERIVED_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode: IDBTransactionMode, storeName: string = STORE): Promise<IDBObjectStore> {
  return openDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function asPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getDerivedValue(key: string): Promise<unknown> {
  return asPromise((await tx('readonly', DERIVED_STORE)).get(key));
}

async function putDerivedValue(key: string, value: unknown): Promise<void> {
  await asPromise((await tx('readwrite', DERIVED_STORE)).put(value, key));
}

interface FilteredVariantRecency {
  version: 1;
  keys: string[];
}

function filteredVariantRecencyKey(photoId: string, tier: PhotoTier): string {
  return `${filteredPhotoNamespace(photoId)}@${tier}@pf-recency-v1`;
}

function isFilteredVariantKey(key: string, prefix: string): boolean {
  if (!key.startsWith(prefix)) return false;
  const suffix = key.slice(prefix.length);
  const separator = suffix.lastIndexOf('@');
  if (separator <= 0) return false;
  const lutId = suffix.slice(0, separator);
  const strengthText = suffix.slice(separator + 1);
  const strength = Number(strengthText);
  return LutIdSchema.safeParse(lutId).success
    && Number.isInteger(strength)
    && strength >= 5
    && strength <= 100
    && strength % 5 === 0
    && String(strength) === strengthText;
}

function parseFilteredVariantRecency(value: unknown): string[] {
  if (
    typeof value !== 'object'
    || value === null
    || (value as Partial<FilteredVariantRecency>).version !== 1
    || !Array.isArray((value as Partial<FilteredVariantRecency>).keys)
  ) {
    return [];
  }
  return (value as FilteredVariantRecency).keys.filter(
    (key): key is string => typeof key === 'string',
  );
}

function transactionFailure(
  transaction: IDBTransaction,
  capturedError: unknown,
): Error {
  if (capturedError instanceof Error) return capturedError;
  if (transaction.error) return transaction.error;
  return new Error('Filtered derived-cache transaction aborted');
}

async function maintainFilteredVariant(
  photoId: string,
  tier: PhotoTier,
  key: string,
  newBlob?: Blob,
): Promise<void> {
  const prefix = filteredVariantPrefix(photoId, tier);
  const metadataKey = filteredVariantRecencyKey(photoId, tier);
  const db = await openDb();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(DERIVED_STORE, 'readwrite');
    const store = transaction.objectStore(DERIVED_STORE);
    let capturedError: unknown;
    let allKeys: IDBValidKey[] | undefined;
    let metadata: unknown;
    let metadataReady = false;
    let mutationsQueued = false;

    const captureRequestError = <T,>(request: IDBRequest<T>) => {
      request.onerror = () => {
        capturedError = request.error ?? new Error('Filtered derived-cache request failed');
      };
    };

    const abortFor = (error: unknown) => {
      capturedError = error;
      try {
        transaction.abort();
      } catch {
        reject(transactionFailure(transaction, capturedError));
      }
    };

    const queueMutations = () => {
      if (mutationsQueued || !allKeys || !metadataReady) return;
      mutationsQueued = true;
      try {
        const variantKeys = allKeys.filter(
          (candidate): candidate is string =>
            typeof candidate === 'string' && isFilteredVariantKey(candidate, prefix),
        );
        if (newBlob) {
          if (!variantKeys.includes(key)) variantKeys.push(key);
        } else if (!variantKeys.includes(key)) {
          throw new Error(`Filtered cache hit disappeared before MRU touch: ${key}`);
        }

        const existing = new Set(variantKeys);
        const orderedPrior = parseFilteredVariantRecency(metadata).filter(
          (candidate) => candidate !== key && existing.has(candidate),
        );
        // If metadata is missing/corrupt/stale, preserve one deterministic
        // actual prior entry rather than discarding every recoverable variant.
        const prior = orderedPrior.at(-1)
          ?? variantKeys.filter((candidate) => candidate !== key).sort()[0];
        const retained = prior ? [prior, key] : [key];
        const retainedSet = new Set(retained.slice(-FILTERED_VARIANT_LIMIT));

        if (newBlob) {
          captureRequestError(store.put(newBlob, key));
        }
        captureRequestError(store.put({
          version: 1,
          keys: [...retainedSet],
        } satisfies FilteredVariantRecency, metadataKey));
        for (const candidate of variantKeys) {
          if (!retainedSet.has(candidate)) {
            captureRequestError(store.delete(candidate));
          }
        }
      } catch (error) {
        abortFor(error);
      }
    };

    const keysRequest = store.getAllKeys();
    keysRequest.onsuccess = () => {
      allKeys = keysRequest.result;
      queueMutations();
    };
    captureRequestError(keysRequest);

    const metadataRequest = store.get(metadataKey);
    metadataRequest.onsuccess = () => {
      metadata = metadataRequest.result;
      metadataReady = true;
      queueMutations();
    };
    captureRequestError(metadataRequest);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      capturedError ??= transaction.error;
    };
    transaction.onabort = () => reject(transactionFailure(transaction, capturedError));
  });
}

// blob: URL 缓存带 LRU 上限:超限就 revoke 最久未用的,防止长会话/大相册把
// 解码位图和 blob 句柄越攒越多(此前只增不减)。key 与持久化派生版本 key 一致。
const URL_CACHE_MAX = 600;
const urlCache = new Map<string, string>();

function cacheUrl(key: string, url: string): void {
  urlCache.set(key, url);
  if (urlCache.size <= URL_CACHE_MAX) return;
  for (const [oldKey, oldUrl] of urlCache) {
    if (urlCache.size <= URL_CACHE_MAX) break;
    urlCache.delete(oldKey);
    URL.revokeObjectURL(oldUrl);
  }
}

function cachedUrl(key: string): string | undefined {
  const url = urlCache.get(key);
  if (url === undefined) return undefined;
  // Map 迭代序 = 插入序;重插把它挪到队尾,实现 LRU 的 "touch"。
  urlCache.delete(key);
  urlCache.set(key, url);
  return url;
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

// 原图 → 降采样 JPEG blob(屏显派生用)。HEIC 先转可解码格式,再 canvas 缩放。
async function downscaleToJpeg(blob: Blob, maxEdge: number, quality: number): Promise<Blob> {
  const decodable = await prepareImageBlobForBrowserDecode(blob);
  const img = await decodeBlob(decodable);
  let canvas: HTMLCanvasElement | null = null;
  try {
    const { w, h } = fitWithinMaxEdge(img.width, img.height, maxEdge);
    // 已经不比目标大:直接用可解码 blob,省一次重编码画质损失。
    if (w >= img.width && h >= img.height) return decodable;
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('derived image canvas context unavailable');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const out = await new Promise<Blob | null>((resolve) =>
      canvas!.toBlob(resolve, 'image/jpeg', quality),
    );
    if (!out) throw new Error('derived image toBlob failed');
    return out;
  } finally {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    img.close?.();
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

async function blobToPdfJpegBlob(blob: Blob, maxEdge: number): Promise<Blob> {
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
    const out = await new Promise<Blob | null>((resolve) =>
      canvas!.toBlob(resolve, 'image/jpeg', PDF_IMAGE_QUALITY),
    );
    if (!out) throw new Error('PDF image toBlob failed');
    return out;
  } finally {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    img.close?.();
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('PDF image FileReader returned a non-string result'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('PDF image FileReader failed'));
    reader.readAsDataURL(blob);
  });
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

interface OriginalBlobReader {
  getBlob(photoId: string): Promise<Blob | undefined>;
}

async function getBaseTierBlob(
  owner: OriginalBlobReader,
  photoId: string,
  tier: PhotoTier,
): Promise<Blob | undefined> {
  const key = derivedCacheKey(photoId, tier, null);
  let derived = (await getDerivedValue(key)) as Blob | undefined;
  if (!derived) {
    const original = await owner.getBlob(photoId);
    if (!original) return undefined;
    derived = await downscaleToJpeg(original, TIER_MAX_EDGE[tier], TIER_QUALITY[tier]);
    // 持久化失败不致命(隐私无新增面:派生图和原图同库同生命周期)。
    // 上传档(backup)不落盘:见 UNCACHED_TIERS。
    if (!UNCACHED_TIERS.has(tier)) {
      try {
        await putDerivedValue(key, derived);
      } catch {
        /* keep the in-memory blob */
      }
    }
  }
  return derived;
}

export interface TierBlobResult {
  blob: Blob | undefined;
  filteredFallback: boolean;
}

async function getTierBlobResult(
  owner: OriginalBlobReader,
  photoId: string,
  tier: PhotoTier,
  photoFilter?: PhotoFilterState | null,
): Promise<TierBlobResult> {
  const ref = effectiveFilter(photoFilter, photoId);
  if (!ref) {
    return {
      blob: await getBaseTierBlob(owner, photoId, tier),
      filteredFallback: false,
    };
  }

  const key = derivedCacheKey(photoId, tier, ref);
  const cached = await getDerivedValue(key);
  if (cached instanceof Blob) {
    try {
      await maintainFilteredVariant(photoId, tier, key);
    } catch (error) {
      console.warn('Filtered cache transaction failed during MRU touch', {
        photoId,
        tier,
        key,
      }, error);
    }
    return { blob: cached, filteredFallback: false };
  }

  const base = await getBaseTierBlob(owner, photoId, tier);
  if (!base) return { blob: undefined, filteredFallback: false };
  const filtered = await lutEngine.applyToBlob(base, ref, 'full');
  if (filtered === base) {
    console.warn('Filtered tier render returned the base Blob; variant not cached', {
      photoId,
      tier,
      key,
    });
    return { blob: base, filteredFallback: true };
  }

  // 上传档同样不落盘(见 UNCACHED_TIERS):带滤镜这条路才是备份的常态,
  // 只堵住无滤镜那条等于没堵。
  if (!UNCACHED_TIERS.has(tier)) {
    try {
      await maintainFilteredVariant(photoId, tier, key, filtered);
    } catch (error) {
      console.warn('Filtered cache transaction failed; using in-memory rendered Blob', {
        photoId,
        tier,
        key,
      }, error);
    }
  }
  return { blob: filtered, filteredFallback: false };
}

/** 取一张已备份的服务器压缩图。取不到就是 undefined —— 单张缺图只影响这一张,
 *  绝不能把整本导出拖垮(与 getTierUrls 里「逐张隔离」同一条口径)。
 *  失败原因写进 warn:跨域没开 CORS、快照被清、离线,现场只能靠这条日志区分。 */
async function fetchBackupBlob(url: string | undefined, photoId: string): Promise<Blob | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) {
      console.warn('[photo] backup snapshot fetch failed', { photoId, status: res.status });
      return undefined;
    }
    return await res.blob();
  } catch (error) {
    console.warn('[photo] backup snapshot fetch threw', { photoId, url }, error);
    return undefined;
  }
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

  // Cached blob: URL of the ORIGINAL — only for surfaces that truly need full
  // resolution. On-screen rendering should use getTierUrl(s) instead.
  async getObjectUrl(photoId: string): Promise<string | undefined> {
    const key = `${photoId}@original`;
    const cached = cachedUrl(key);
    if (cached) return cached;
    const blob = await this.getBlob(photoId);
    if (!blob) return undefined;
    const displayBlob = await prepareImageBlobForBrowserDecode(blob);
    const url = URL.createObjectURL(displayBlob);
    cacheUrl(key, url);
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

  // 屏显派生图的降采样 JPEG blob:先读 derived 表,缺失则从原图生成并回存。原图不在
  // 本机(getBlob 为空)→ undefined。手动备份(photo-snapshot)复用它拿要上传 R2 的
  // 压缩字节 —— 与屏显同一份派生图,不重复编码。IndexedDB/解码异常向上抛,由调用方处理。
  async getTierBlob(
    photoId: string,
    tier: PhotoTier,
    photoFilter?: PhotoFilterState | null,
  ): Promise<Blob | undefined> {
    return (await getTierBlobResult(this, photoId, tier, photoFilter)).blob;
  },

  // Snapshot uploads need to distinguish an exact filtered render from the
  // deliberate on-screen fallback to the base image. Never label fallback bytes
  // with a filtered immutable renderVersion.
  async getTierBlobStatus(
    photoId: string,
    tier: PhotoTier,
    photoFilter?: PhotoFilterState | null,
  ): Promise<TierBlobResult> {
    return getTierBlobResult(this, photoId, tier, photoFilter);
  },

  // 屏显派生图:降采样 JPEG 的 blob: URL。首次生成后持久化进 IndexedDB(derived
  // 表),之后直接读缓存。任何一步失败(无 canvas 的环境/解码失败)回退原图 URL,
  // 绝不因为派生失败白屏。
  async getTierUrl(
    photoId: string,
    tier: PhotoTier,
    photoFilter?: PhotoFilterState | null,
  ): Promise<string | undefined> {
    const ref = effectiveFilter(photoFilter, photoId);
    const key = derivedCacheKey(photoId, tier, ref);
    const cached = cachedUrl(key);
    if (cached) {
      if (ref) {
        try {
          await maintainFilteredVariant(photoId, tier, key);
        } catch (error) {
          console.warn('Filtered cache transaction failed during URL-cache MRU touch', {
            photoId,
            tier,
            key,
          }, error);
        }
      }
      return cached;
    }
    try {
      const result = await getTierBlobResult(this, photoId, tier, photoFilter);
      if (!result.blob) return undefined;
      const urlKey = result.filteredFallback
        ? derivedCacheKey(photoId, tier, null)
        : key;
      const existing = cachedUrl(urlKey);
      if (existing) return existing;
      const url = URL.createObjectURL(result.blob);
      cacheUrl(urlKey, url);
      return url;
    } catch {
      // 回退本身也会抛:原图是 HEIC 且 wasm 转不出来时,getObjectUrl 一样走
      // prepareImageBlobForBrowserDecode。让它抛出去就违背了本方法「绝不白屏」的
      // 契约,而且会顺着 getTierUrls 的 Promise.all 把同批其它照片一起带走。
      try {
        return await this.getObjectUrl(photoId);
      } catch {
        return undefined;
      }
    }
  },

  // 批量派生:限制并发(逐张解码原图是内存峰值来源,100 张 Promise.all 会爆)。
  async getTierUrls(
    photoIds: string[],
    tier: PhotoTier,
    photoFilter?: PhotoFilterState | null,
  ): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const queue = [...photoIds];
    const worker = async () => {
      for (;;) {
        const id = queue.shift();
        if (id === undefined) return;
        // 逐张隔离:单张失败只是这张缺图,绝不能让 Promise.all 整批 reject —— 调用方
        // (MobileEditorRoot 的 .catch(() => ({})))会把整本书的照片一起抹空。
        try {
          const url = await this.getTierUrl(id, tier, photoFilter);
          if (url) out[id] = url;
        } catch (error) {
          console.warn('[photo] tier url failed for one photo', { photoId: id, tier }, error);
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    return out;
  },

  // PDF export is memory-bound in the browser: never hand original phone-photo
  // data URLs. Decode from Blob, cap size locally, and process photos sequentially
  // so peak memory stays bounded before the PDF is assembled.
  // maxEdge：栅格导出（html2canvas 高倍截图）传 RASTER_PDF_IMAGE_MAX_EDGE，
  // 否则源图被降到默认 1600 后放大 3-4 倍会糊。
  //
  // backupUrls:已备份到服务器的压缩图(photoId→URL,即 album.photoSnapshotUrls)。
  // **本地没有原图时的回落**,与展示层 `imageUrls[id] ?? snapshotUrls[id]` 同一条规则 ——
  // 早先这条规则只做在展示层,导出自建 resolver 没接上,于是「已备份 + 本地没原图」
  // (换设备/清缓存)屏幕上看得见、导出出来是空图。见 export-backup-fallback.test.ts。
  async getPdfDataUrls(
    photoIds: string[],
    maxEdge = PDF_IMAGE_MAX_EDGE,
    photoFilter?: PhotoFilterState | null,
    backupUrls?: Record<string, string> | null,
  ): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const id of photoIds) {
      const blob = await this.getBlob(id);
      if (!blob) {
        // 备份的字节是 display 档、**滤镜已经烘进去**的(上传的就是
        // getTierBlobStatus(id,'display',frozenState),renderVersion 也是拿滤镜算的)。
        // 所以这里只做尺寸夹取,不再套一次当前滤镜 —— 套了就是同一个 LUT 叠两遍。
        const backup = await fetchBackupBlob(backupUrls?.[id], id);
        if (backup) out[id] = await blobToPdfDataUrl(backup, maxEdge);
        continue;
      }
      const ref = effectiveFilter(photoFilter, id);
      if (!ref) {
        out[id] = await blobToPdfDataUrl(blob, maxEdge);
        continue;
      }

      const base = await blobToPdfJpegBlob(blob, maxEdge);
      const filtered = await lutEngine.applyToBlob(base, ref, 'full');
      if (filtered === base) {
        console.warn('PDF filtered render returned the exact downsized base Blob', {
          photoId: id,
          ref,
        });
      }
      out[id] = await blobToDataUrl(filtered);
    }
    return out;
  },

  revokeAll(): void {
    for (const url of urlCache.values()) URL.revokeObjectURL(url);
    urlCache.clear();
  },
};
