'use client';

import { assignClusterIds, type ClusterInput } from '@/lib/photo/cluster';
import { uploadAnalyzePreviews } from './analyze-upload';
import { compressFile, type CompressedPhoto } from '@/lib/photo/compress';
import { representativePlaceForGroup } from '@/lib/photo/geocode';
import { photoStore } from '@/lib/photo/store';
import {
  confirmPhotoSnapshot,
  putSnapshotBlob,
  signPhotoSnapshotUpload,
  type SnapshotEntry,
} from '@/lib/album/photo-snapshot-client';

// Browser-side client for the generation endpoints. Owns the two billing-aware
// flows BILL-1 defines so /create (UI-2) and /my-albums + /album (UI-4) consume
// one shared implementation instead of re-deriving error handling per screen:
//   • submit / retry both surface CREDIT_INSUFFICIENT as a typed error so the
//     caller can route to /credits and resume (§6.5.2);
//   • retry reuses the same albumId (§6.5.3), the browser resending base64.

export type GenerationPhoto = {
  photoId: string;
  base64: string;
  width: number;
  height: number;
  // EXIF capture time (ISO 8601) or null — produced by compressFile, forwarded to
  // the Agent as a deterministic chaptering signal. takenAt is the ONLY EXIF field
  // carried (D-GPS: no coordinates ever enter the payload).
  takenAt?: string | null;
  // Opaque spatio-temporal cluster label (c1/c2/…), derived in the browser from EXIF
  // time+GPS by `assignClusterIds` (#232). It is the ONLY thing that leaves the geo
  // computation — NO coordinate is ever carried. `null`/omitted when un-clusterable
  // (no EXIF) → the Agent degrades to its prior "one big batch" behaviour.
  clusterId?: string | null;
};

// Run the browser's deterministic spatio-temporal clustering over a set of
// freshly-compressed photos and return clean GenerationPhotos with `clusterId`
// attached. PRIVACY (#232 / architecture §3): the transient `clusterGeo` is read
// here ONLY to compute cluster labels and is DROPPED — it never appears on the
// returned object, so coordinates can never reach the request body.
export function clusterCompressedPhotos(
  compressed: readonly CompressedPhoto[],
): GenerationPhoto[] {
  const inputs: ClusterInput[] = compressed.map((p) => ({
    photoId: p.photoId,
    takenAt: p.takenAt,
    geo: p.clusterGeo,
  }));
  const clusterIds = assignClusterIds(inputs);
  return compressed.map((p) => ({
    photoId: p.photoId,
    base64: p.base64,
    width: p.width,
    height: p.height,
    takenAt: p.takenAt,
    clusterId: clusterIds.get(p.photoId) ?? null,
    // NOTE: p.clusterGeo is intentionally NOT spread here — coordinates stop at clustering.
  }));
}

// 采访预填(每个 clusterId 一条):内容采集环节要给用户预填「时间:… 地点:…」。
// 地名和时间必须在**提交时**(坐标还在浏览器内存)按 clusterId 预算好——因为 analyze
// 一旦返回,坐标早已随聚类丢弃,再也无法反查。采访(analyze 回来后弹)按 clusterId↔章
// 映射取用这份预填。PRIVACY:place 是反地理编码出的**城市级地名字符串**,坐标不在其中;
// 这里读 clusterGeo 反查后即弃,坐标不进任何返回值 / 请求体 / 存储。
export type ChapterPrefill = {
  clusterId: string;
  // EXIF 时间范围(该组最早/最晚 takenAt,ISO 或 null)。采访据此判断「时间是否已知」。
  earliestTakenAt: string | null;
  latestTakenAt: string | null;
  // 反地理编码出的代表地名(一章一个,取众数);无 GPS / 反查失败 => null。
  place: string | null;
};

// 按 clusterId 分组,对每组算采访预填(时间范围 + 众数地名)。坐标只在本函数内参与反查,
// 出去的只有地名字符串。反地理编码可能慢/失败,不阻塞主流程 —— 调用方可 fire-and-forget
// 或带 signal 取消。无 GPS 的组 place=null,采访退化为让用户手填地点。
export async function chapterPrefillsFromCompressed(
  compressed: readonly CompressedPhoto[],
  { signal }: { signal?: AbortSignal } = {},
): Promise<ChapterPrefill[]> {
  const inputs: ClusterInput[] = compressed.map((p) => ({
    photoId: p.photoId,
    takenAt: p.takenAt,
    geo: p.clusterGeo,
  }));
  const clusterIds = assignClusterIds(inputs);

  // 按 clusterId 聚合:该组的 takenAt 列表 + geo 列表(geo 用完即弃)。
  const groups = new Map<
    string,
    { times: string[]; geos: (CompressedPhoto['clusterGeo'])[] }
  >();
  for (const p of compressed) {
    const cid = clusterIds.get(p.photoId);
    if (!cid) continue;
    const g = groups.get(cid) ?? { times: [], geos: [] };
    if (p.takenAt) g.times.push(p.takenAt);
    g.geos.push(p.clusterGeo);
    groups.set(cid, g);
  }

  const out: ChapterPrefill[] = [];
  for (const [clusterId, { times, geos }] of groups) {
    const sorted = [...times].sort();
    const place = await representativePlaceForGroup(geos, { signal });
    out.push({
      clusterId,
      earliestTakenAt: sorted[0] ?? null,
      latestTakenAt: sorted[sorted.length - 1] ?? null,
      place, // 坐标已在 representativePlaceForGroup 内消费并丢弃,这里只余地名字符串
    });
  }
  return out;
}

// Reorders the in-memory compressed set to match `photoIds`, returning null if any
// requested id is missing (caller then rebuilds from IndexedDB). Returns the raw
// CompressedPhotos (geo still attached) — the caller runs clustering next, which is
// where the transient geo is dropped.
export function compressedPhotosFromCache(
  photoIds: readonly string[],
  cachedPhotos?: readonly CompressedPhoto[] | null,
): CompressedPhoto[] | null {
  if (!cachedPhotos || cachedPhotos.length === 0) return null;
  const byId = new Map(cachedPhotos.map((photo) => [photo.photoId, photo]));
  const out: CompressedPhoto[] = [];
  for (const photoId of photoIds) {
    const photo = byId.get(photoId);
    if (!photo) return null;
    out.push(photo);
  }
  return out;
}

export function selectLayoutRefsFromCompressed(
  compressed: readonly CompressedPhoto[],
): Record<string, string> {
  return Object.fromEntries(compressed.map((photo) => [photo.photoId, photo.base64]));
}

// Thrown on a 402 so callers can branch on `instanceof` instead of matching the
// error code string. Carries nothing else — the create flow already knows the
// draft it just tried to submit.
export class CreditInsufficientError extends Error {
  readonly code = 'CREDIT_INSUFFICIENT';
  constructor() {
    super('Not enough credits');
    this.name = 'CreditInsufficientError';
  }
}

export class UnauthorizedError extends Error {
  readonly code = 'UNAUTHORIZED';
  constructor() {
    super('Login required');
    this.name = 'UnauthorizedError';
  }
}

// 游客撞硬上限(20 张 / 1 本):处置与未登录同款 —— 存草稿跳登录,登录后 resume
// 自动重交(解锁 100 张/多本)。单独成类是为了和真 401 在日志/文案上可区分。
export class AnonLimitError extends Error {
  readonly code: string;
  constructor(code: 'ANON_PHOTO_LIMIT' | 'ANON_ALBUM_LIMIT') {
    super('Guest limit reached — sign in to continue');
    this.name = 'AnonLimitError';
    this.code = code;
  }
}

// Thrown when one or more originals can't be rebuilt from IndexedDB (cache
// cleared / different device). Carries the missing ids so the caller can react
// without re-deriving them.
export class PhotosUnavailableError extends Error {
  readonly code = 'PHOTOS_UNAVAILABLE';
  readonly missingIds: string[];
  constructor(missingIds: string[]) {
    super('Some photos are no longer available on this device');
    this.name = 'PhotosUnavailableError';
    this.missingIds = missingIds;
  }
}

// Rebuild base64 photos from the originals in IndexedDB (invariant 1). Used by
// retry and resume-after-purchase, where the base64 isn't in memory anymore.
// A missing original is NOT silently skipped: dropping it would resubmit a photo
// set that no longer matches the album's photoCount. Any missing id aborts with
// PhotosUnavailableError so the caller surfaces an honest dead-end instead.
export async function photosFromStore(photoIds: string[]): Promise<GenerationPhoto[]> {
  const compressed: CompressedPhoto[] = [];
  const missing: string[] = [];
  for (const photoId of photoIds) {
    const blob = await photoStore.getBlob(photoId);
    if (!blob) {
      missing.push(photoId);
      continue;
    }
    compressed.push(await compressFile(blob, photoId));
  }
  if (missing.length > 0) throw new PhotosUnavailableError(missing);
  // Cluster + strip transient geo in one place, so the rebuild path emits the same
  // clusterId-bearing, coordinate-free GenerationPhotos as the fresh-upload path.
  return clusterCompressedPhotos(compressed);
}

// 采访数据(内容采集 §2.1a):从 IndexedDB 原图重算「photoId→clusterId」映射 + 每 cluster 的
// 预填(时间范围 + 反查地名)。在 progress=50 采访弹出时当场算 —— 原图还在本地,坐标还能读。
// assignClusterIds 确定性,与提交时同一批 photoId 得同样的 clusterId,映射稳定对得上。
// PRIVACY:geo 在 chapterPrefillsFromCompressed 内反查后即弃,返回值只含 clusterId + 地名字符串。
export async function interviewDataFromStore(photoIds: readonly string[]): Promise<{
  photoToCluster: Map<string, string>;
  prefills: ChapterPrefill[];
}> {
  const compressed: CompressedPhoto[] = [];
  for (const photoId of photoIds) {
    const blob = await photoStore.getBlob(photoId);
    if (!blob) continue; // 采访是可选的,缺图的照片跳过,不像排版那样硬失败
    compressed.push(await compressFile(blob, photoId));
  }
  const inputs: ClusterInput[] = compressed.map((p) => ({
    photoId: p.photoId,
    takenAt: p.takenAt,
    geo: p.clusterGeo,
  }));
  const photoToCluster = assignClusterIds(inputs);
  const prefills = await chapterPrefillsFromCompressed(compressed);
  return { photoToCluster, prefills };
}

export async function selectLayoutRefsFromStore(photoIds: string[]): Promise<Record<string, string>> {
  const compressed: CompressedPhoto[] = [];
  const missing: string[] = [];
  for (const photoId of photoIds) {
    const blob = await photoStore.getBlob(photoId);
    if (!blob) {
      missing.push(photoId);
      continue;
    }
    compressed.push(await compressFile(blob, photoId, { maxLen: 200, quality: 0.65 }));
  }
  if (missing.length > 0) throw new PhotosUnavailableError(missing);
  return selectLayoutRefsFromCompressed(compressed);
}

type SubmitResult = { albumId: string; requestId: string };

// 平台级失败(413/502/504…)返回的是 text/plain 或 HTML,不是我们的 {ok,error} 信封。
// 无脑 res.json() 会抛 SyntaxError,用户看到的是
// `Unexpected token 'R', "Request En"... is not valid JSON` —— 上传照片撞 413 时
// 线上就是这么甩人脸的。这里统一把「响应体不是 JSON」翻成带状态码的人话。
async function readJsonEnvelope(res: Response, path: string): Promise<{
  ok?: boolean;
  data?: unknown;
  error?: { code?: string; message?: string };
}> {
  const text = await res.text();
  try {
    return JSON.parse(text) as { ok?: boolean; error?: { code?: string; message?: string } };
  } catch {
    throw new Error(`${path} failed (HTTP ${res.status})`);
  }
}

async function postJobs(path: string, body: unknown): Promise<SubmitResult> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await readJsonEnvelope(res, path);
  if (!json.ok) {
    if (res.status === 401 || json.error?.code === 'UNAUTHORIZED') throw new UnauthorizedError();
    if (json.error?.code === 'CREDIT_INSUFFICIENT') throw new CreditInsufficientError();
    if (json.error?.code === 'ANON_PHOTO_LIMIT' || json.error?.code === 'ANON_ALBUM_LIMIT') {
      throw new AnonLimitError(json.error.code as 'ANON_PHOTO_LIMIT' | 'ANON_ALBUM_LIMIT');
    }
    if (json.error?.code === 'ANALYZE_UPLOAD_INCOMPLETE') {
      // message 是服务端刻意只回的「缺失张数」,不是给人看的文案。
      throw new PhotosUploadIncompleteError(Number(json.error.message) || 1);
    }
    throw new Error(json.error?.message ?? 'Request failed');
  }
  return json.data as SubmitResult;
}

function jpegDataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error('generation preview must be a JPEG data URL');
  const decoded = atob(match[1]!);
  const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: 'image/jpeg' });
}

async function backupGenerationPreviews(
  albumId: string,
  photos: GenerationPhoto[],
): Promise<void> {
  const entries: SnapshotEntry[] = photos.map(({ photoId }) => ({
    photoId,
    renderVersion: 'pf-v1__original',
  }));
  if (entries.length === 0) return;

  const signed = await signPhotoSnapshotUpload(albumId, entries);
  const blobs = new Map(photos.map((photo) => [photo.photoId, jpegDataUrlToBlob(photo.base64)]));
  const signedByPhoto = new Map(signed.map((item) => [item.photoId, item]));
  if (
    signedByPhoto.size !== entries.length ||
    entries.some((entry) => signedByPhoto.get(entry.photoId)?.renderVersion !== entry.renderVersion)
  ) {
    throw new Error('photo snapshot signatures did not match generation previews');
  }

  const uploaded: SnapshotEntry[] = [];
  const queue = [...entries];
  const worker = async () => {
    for (;;) {
      const entry = queue.shift();
      if (!entry) return;
      const target = signedByPhoto.get(entry.photoId)!;
      const blob = blobs.get(entry.photoId)!;
      try {
        await putSnapshotBlob(target.putUrl, blob);
        uploaded.push(entry);
      } catch {
        // Partial cloud backup is still useful; confirm only successful PUTs.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker));
  if (uploaded.length > 0) await confirmPhotoSnapshot(albumId, uploaded);
}

// 一张都没传上去 / 传了一部分:调用方必须看见。绝不能悄悄建一本缺图的书 ——
// photoCount 会和实际字节对不上,排版出来就是空框。
export class PhotosUploadFailedError extends Error {
  readonly code = 'PHOTOS_UPLOAD_FAILED';
  readonly failedPhotoIds: string[];
  constructor(failedPhotoIds: string[]) {
    super(`${failedPhotoIds.length} photo(s) failed to upload`);
    this.name = 'PhotosUploadFailedError';
    this.failedPhotoIds = failedPhotoIds;
  }
}

// 浏览器以为都传上去了,服务端去 R2 取却少了几张(PUT 静默失败 / 预签名过期 /
// 两个标签页之间会话从游客翻成正式账号,key 前缀里的 userId 变了)。
// 服务端的 ANALYZE_UPLOAD_INCOMPLETE 只回个数(不回 photoId,见 error-codes.ts),
// 所以 error.message 是个裸数字 "2" —— 直接 setErr(e.message) 就会给用户弹一个
// 写着「2」的框。这个类型把它接住,调用方拿 missingCount 去套 i18n 文案。
export class PhotosUploadIncompleteError extends Error {
  readonly code = 'ANALYZE_UPLOAD_INCOMPLETE';
  readonly missingCount: number;
  constructor(missingCount: number) {
    super(`${missingCount} uploaded photo(s) were not found on the server`);
    this.name = 'PhotosUploadIncompleteError';
    this.missingCount = missingCount;
  }
}

async function signAnalyzeUploads(
  photoIds: string[],
): Promise<{ sessionId: string; uploads: { photoId: string; putUrl: string }[] }> {
  const path = '/api/v3/albums/upload-urls';
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoIds }),
  });
  const json = await readJsonEnvelope(res, path);
  if (!json.ok) {
    if (res.status === 401 || json.error?.code === 'UNAUTHORIZED') throw new UnauthorizedError();
    throw new Error(json.error?.message ?? 'Failed to sign photo uploads');
  }
  return json.data as { sessionId: string; uploads: { photoId: string; putUrl: string }[] };
}

async function putAnalyzePreview(putUrl: string, blob: Blob): Promise<void> {
  const res = await fetch(putUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: blob,
  });
  if (!res.ok) throw new Error(`analyze preview PUT failed (${res.status})`);
}

export async function submitAnalyzeV3(
  input: {
    requestId: string;
    language: 'zh' | 'en';
    promptHint?: string;
    photos: GenerationPhoto[];
  },
  opts: { skipCloudBackup?: boolean; onUploadProgress?: (done: number, total: number) => void } = {},
): Promise<SubmitResult> {
  // 照片字节先直传 R2,建书请求只带 photoId + 元数据。改造前这些 base64 内联在
  // body 里,27~50 张就撞 Vercel 4.5MB 的 FUNCTION_PAYLOAD_TOO_LARGE(413)。
  const { sessionId, uploadedPhotoIds, failedPhotoIds } = await uploadAnalyzePreviews({
    photos: input.photos.map((photo) => ({
      photoId: photo.photoId,
      blob: jpegDataUrlToBlob(photo.base64),
    })),
    deps: { sign: signAnalyzeUploads, put: putAnalyzePreview },
    ...(opts.onUploadProgress ? { onProgress: opts.onUploadProgress } : {}),
  });
  if (failedPhotoIds.length > 0) throw new PhotosUploadFailedError(failedPhotoIds);

  const uploaded = new Set(uploadedPhotoIds);
  const result = await postJobs('/api/v3/albums', {
    requestId: input.requestId,
    language: input.language,
    ...(input.promptHint ? { promptHint: input.promptHint } : {}),
    uploadSessionId: sessionId,
    // 剥掉 base64:字节已经在 R2 了,再塞一份进 body 就等于什么都没改。
    photos: input.photos
      .filter((photo) => uploaded.has(photo.photoId))
      .map(({ base64: _base64, ...meta }) => meta),
  });
  // 游客零 R2 写入:快照备份是真实账号的能力(服务端也会 403),干脆不发起。
  if (!opts.skipCloudBackup) {
    try {
      await backupGenerationPreviews(result.albumId, input.photos);
    } catch {
      // The album/Agent job already exists. A cloud-backup outage must not make the
      // user retry creation and accidentally create or charge for a second album.
    }
  }
  return result;
}

// 加照片增量重跑(spec §1):只发新照片,服务端 hold 积分并转发 analyze;后续采访/
// 排版由 ChatPanel 复用既有链路。402 → CreditInsufficientError(buy-banner)。
export function submitAddPhotosV3(
  albumId: string,
  input: { requestId: string; language: 'zh' | 'en'; photos: GenerationPhoto[] },
): Promise<SubmitResult> {
  return postJobs(`/api/v3/albums/${albumId}/add-photos`, input);
}

export function retryGeneration(
  albumId: string,
  input: { requestId: string; language: 'zh' | 'en'; photos: GenerationPhoto[] },
): Promise<SubmitResult> {
  return postJobs(`/api/v3/albums/${albumId}/retry`, input);
}

export function submitSelectLayoutV3(
  albumId: string,
  input: {
    requestId: string;
    language: 'zh' | 'en';
    refs: Record<string, string> | Array<{ photoId: string; ref200px: string }>;
    // 追加照片(加图增量重跑):只排这些新章节,新页由服务端插进成书。省略 = 全书。
    chapterIds?: string[];
  },
): Promise<SubmitResult> {
  return postJobs(`/api/v3/albums/${albumId}/select-layout`, input);
}

// 追加范围成稿:加图增量排版落地后,只为新章内页写文案。composed:false = 书未设计,
// 新页文案等选封面时随全书成稿一起写。
export async function composeAppendV3(
  albumId: string,
  input: { language: 'zh' | 'en'; chapterIds: string[]; refs: Record<string, string> },
): Promise<{ accepted: true; composed: boolean; requestId?: string }> {
  const res = await fetch(`/api/v3/albums/${albumId}/compose-append`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (!json.ok) {
    if (res.status === 401 || json.error?.code === 'UNAUTHORIZED') throw new UnauthorizedError();
    throw new Error(json.error?.message ?? 'append compose failed');
  }
  return json.data;
}

// /design 轻量状态(追加成稿轮询用):composing + 最近一单 compose 的最终状态 + 是否真写出
// 了页(COMPLETED 不等于写了 —— 整章掉队时也是 COMPLETED,靠 lastComposeWrote 区分)。
export async function fetchDesignState(
  albumId: string,
): Promise<{
  composing: boolean;
  lastComposeStatus: string | null;
  lastComposeWrote: boolean | null;
  // lastComposeStale:这单 compose 因运行期间的人工编辑被基线闸拦下
  // (AI_RESULT_STALE),前端据此说「基于最新版本重跑」,不伪装成成功也不报笼统失败。
  lastComposeStale: boolean;
}> {
  const res = await fetch(`/api/v3/albums/${albumId}/design`);
  const json = await res.json();
  if (!json.ok) {
    if (res.status === 401 || json.error?.code === 'UNAUTHORIZED') throw new UnauthorizedError();
    throw new Error(json.error?.message ?? 'design state failed');
  }
  return {
    composing: !!json.data.composing,
    lastComposeStatus: json.data.lastComposeStatus ?? null,
    lastComposeWrote: json.data.lastComposeWrote ?? null,
    lastComposeStale: json.data.lastComposeStale === true,
  };
}
