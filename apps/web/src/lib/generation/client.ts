'use client';

import { assignClusterIds, type ClusterInput } from '@/lib/photo/cluster';
import { compressFile, type CompressedPhoto } from '@/lib/photo/compress';
import { representativePlaceForGroup } from '@/lib/photo/geocode';
import { photoStore } from '@/lib/photo/store';

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

async function postJobs(path: string, body: unknown): Promise<SubmitResult> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) {
    if (res.status === 401 || json.error?.code === 'UNAUTHORIZED') throw new UnauthorizedError();
    if (json.error?.code === 'CREDIT_INSUFFICIENT') throw new CreditInsufficientError();
    throw new Error(json.error?.message ?? 'Request failed');
  }
  return json.data as SubmitResult;
}

export function submitAnalyzeV3(input: {
  requestId: string;
  language: 'zh' | 'en';
  promptHint?: string;
  photos: GenerationPhoto[];
}): Promise<SubmitResult> {
  return postJobs('/api/v3/albums', input);
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
  },
): Promise<SubmitResult> {
  return postJobs(`/api/v3/albums/${albumId}/select-layout`, input);
}

// ── P2 phase 2 (docs/agent/contract.md §5.2.1): rendered-thumbnail judge ──
// The browser fetches the candidate STRUCTURES the `candidates` callback stashed,
// renders a thumbnail per candidate (real templates, photos-in-slots, no text), and
// POSTs them so the Agent's Gemini judge picks the winner per unit.

type CandidatePageStruct = { templateId: string; images: Record<string, string> };
type CandidateStruct = { candidateIndex: number; pages: CandidatePageStruct[] };
type CandidateUnit = { unitKey: string; chapterId: string; candidates: CandidateStruct[] };
type JudgeCandidate = CandidateStruct & { thumbnail: string };
type JudgeUnit = {
  unitKey: string;
  chapterId: string;
  chosenIndex?: number;
  candidates: JudgeCandidate[];
};

// The Agent's JudgeCandidate.thumbnail is a REQUIRED non-empty string even when
// chosenIndex is set (the judge then ignores it — see agent flows/judge_layout.py).
// Fallback units carry this 1x1 placeholder so the strict contract still validates.
const PLACEHOLDER_THUMBNAIL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==';

function fallbackUnit(unit: CandidateUnit): JudgeUnit {
  return {
    unitKey: unit.unitKey,
    chapterId: unit.chapterId,
    chosenIndex: 0,
    candidates: unit.candidates.map((c) => ({ ...c, thumbnail: PLACEHOLDER_THUMBNAIL })),
  };
}

export async function fetchJudgeCandidates(
  albumId: string,
  requestId: string,
): Promise<{ ready: boolean; units: CandidateUnit[] }> {
  const res = await fetch(
    `/api/v3/albums/${albumId}/judge-layout?requestId=${encodeURIComponent(requestId)}`,
  );
  const json = await res.json();
  if (!json.ok) {
    if (res.status === 401 || json.error?.code === 'UNAUTHORIZED') throw new UnauthorizedError();
    throw new Error(json.error?.message ?? 'Failed to load layout candidates');
  }
  return json.data as { ready: boolean; units: CandidateUnit[] };
}

// Render thumbnails for every candidate unit, then POST phase 2. Fallback (REQUIRED):
//   • single-candidate unit → chosenIndex=0, no rendering;
//   • a candidate that can't render → its thumbnail is omitted;
//   • a whole unit with no usable thumbnail → chosenIndex=0.
// The Agent judge then takes candidate 0 for any unit it can't compare, so the album
// always completes even if rendering is unavailable.
export async function renderAndSubmitJudgeLayout(
  albumId: string,
  input: { requestId: string; language: 'zh' | 'en'; units: CandidateUnit[] },
): Promise<SubmitResult> {
  // Units needing a real judge (≥2 candidates). When NONE do, skip importing the
  // renderer (html2canvas + templates) and the photo store entirely.
  const needsRender = input.units.some((unit) => unit.candidates.length > 1);

  const renderer = needsRender
    ? await import('@/lib/photo/candidate-thumbnail')
    : null;
  const photoIds = renderer !== null ? renderer.collectCandidatePhotoIds(input.units) : [];
  const photosById =
    renderer !== null ? await renderer.resolveCandidatePhotos(photoIds) : {};

  const units: JudgeUnit[] = [];
  for (const unit of input.units) {
    // Single-candidate units skip rendering entirely — nothing to judge.
    if (unit.candidates.length <= 1 || renderer === null) {
      units.push(fallbackUnit(unit));
      continue;
    }

    const judged: JudgeCandidate[] = [];
    let anyThumbnail = false;
    for (const candidate of unit.candidates) {
      let thumbnail: string | null = null;
      try {
        // 单候选渲染加硬超时,避免 html2canvas 某次挂起拖死整条 phase2。
        thumbnail = await Promise.race([
          renderer.renderCandidateThumbnail(candidate, photosById),
          new Promise<null>((r) => setTimeout(() => r(null), 8000)),
        ]);
      } catch {
        thumbnail = null;
      }
      if (thumbnail) anyThumbnail = true;
      judged.push({ ...candidate, thumbnail: thumbnail ?? PLACEHOLDER_THUMBNAIL });
    }

    // No candidate rendered → let the Agent take candidate 0 for this unit.
    units.push(
      anyThumbnail
        ? { unitKey: unit.unitKey, chapterId: unit.chapterId, candidates: judged }
        : fallbackUnit(unit),
    );
  }

  return postJobs(`/api/v3/albums/${albumId}/judge-layout`, {
    requestId: input.requestId,
    language: input.language,
    units,
  });
}
