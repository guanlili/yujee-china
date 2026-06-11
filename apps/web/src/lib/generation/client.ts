'use client';

import { compressFile } from '@/lib/photo/compress';
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
};

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
  const out: GenerationPhoto[] = [];
  const missing: string[] = [];
  for (const photoId of photoIds) {
    const blob = await photoStore.getBlob(photoId);
    if (!blob) {
      missing.push(photoId);
      continue;
    }
    out.push(await compressFile(blob, photoId));
  }
  if (missing.length > 0) throw new PhotosUnavailableError(missing);
  return out;
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

export function submitGeneration(input: {
  requestId: string;
  prompt: string;
  language: 'zh' | 'en';
  photos: GenerationPhoto[];
}): Promise<SubmitResult> {
  return postJobs('/api/v1/jobs', input);
}

// v2 init (agent rebuild, W10 #140). POST /api/v2/albums starts the init job
// (Stage 1+3) and returns { albumId, requestId } once the agent accepts (202).
// Same billing-aware contract as submitGeneration — CREDIT_INSUFFICIENT routes
// the caller to top up. The prompt is a promptHint here (optional — the
// storytelling happens later in the authoring flow); language is explicit.
export function submitInitV2(input: {
  requestId: string;
  language: 'zh' | 'en';
  promptHint?: string;
  photos: GenerationPhoto[];
}): Promise<SubmitResult> {
  return postJobs('/api/v2/albums', input);
}

// Reuses albumId — no prompt (the server reuses the stored album.prompt).
export function retryGeneration(
  albumId: string,
  input: { requestId: string; language: 'zh' | 'en'; photos: GenerationPhoto[] },
): Promise<SubmitResult> {
  return postJobs(`/api/v1/albums/${albumId}/retry`, input);
}
