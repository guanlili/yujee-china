'use client';

import { UnauthorizedError, CreditInsufficientError } from '@/lib/generation/client';

// Browser-side client for the v2 authoring flow (W10 #140): the read-only draft
// skeleton + the three interactive steps (theme / chapter-chat / finalize). The
// authoring tree itself never crosses to the browser (invariant 12) — these
// endpoints assemble the agent payload server-side from draft_json; the browser
// only owns free-text nudges and which chapter it's chatting about.

// ── Draft skeleton (GET /api/v2/albums/[uuid]/draft) ──
// A read-only RENDER projection: pages flattened into one ordered, re-indexed
// list (shaped like EditorPage so PagePreview can render them), plus per-chapter
// metadata pointing at its [pageStart, pageEnd) slice into that list.

export type DraftPageKind = 'cover' | 'toc' | 'chapter' | 'ending';

export interface DraftSkeletonPage {
  pageIndex: number;
  templateId: string;
  imagesJson: Record<string, string>;
  textsJson: Record<string, string>;
  kind: DraftPageKind;
  chapterId: string | null;
}

// The chapter state machine (requirements §5). 'empty'→'asking'→'brief_ready'
// →'generated'→'finalized', or skipped→'generated'.
export type ChapterState =
  | 'empty'
  | 'asking'
  | 'brief_ready'
  | 'generated'
  | 'skipped'
  | 'finalized';

export interface DraftSkeletonChapter {
  chapterId: string;
  label: string;
  role: 'opening' | 'body' | 'closing';
  state: ChapterState;
  askCount: number;
  pageStart: number;
  pageEnd: number;
}

export interface DraftTheme {
  subject?: string;
  occasion?: string;
  timeframe?: string;
  tone?: string;
  style?: string;
}

export interface DraftSkeleton {
  theme: DraftTheme | null;
  style: string;
  language: 'zh' | 'en';
  pages: DraftSkeletonPage[];
  chapters: DraftSkeletonChapter[];
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const json = await res.json();
  if (!json.ok) {
    if (res.status === 401 || json.error?.code === 'UNAUTHORIZED') throw new UnauthorizedError();
    throw new Error(json.error?.message ?? 'Request failed');
  }
  return json.data as T;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json();
  if (!json.ok) {
    if (res.status === 401 || json.error?.code === 'UNAUTHORIZED') throw new UnauthorizedError();
    if (json.error?.code === 'CREDIT_INSUFFICIENT') throw new CreditInsufficientError();
    throw new Error(json.error?.message ?? 'Request failed');
  }
  return json.data as T;
}

// GET the read-only skeleton. `draft` is null when the album isn't in the draft
// phase (no draft, or already finalized — layout_json set).
export function fetchDraftSkeleton(albumId: string): Promise<{ draft: DraftSkeleton | null }> {
  return getJson(`/api/v2/albums/${albumId}/draft`);
}

// POST /theme — synchronous. `userMessage` is an optional free-text nudge ("make
// it warmer", "this is about my grandmother"); the agent returns a full theme.
export function postTheme(
  albumId: string,
  userMessage?: string,
): Promise<{ theme: unknown; assistantReply: string }> {
  return postJson(`/api/v2/albums/${albumId}/theme`, userMessage ? { userMessage } : {});
}

// POST /chapter-chat — synchronous. Sends the chapterId + the user's message; the
// server slices that chapter and merges the reply back into draft_json.
export function postChapterChat(
  albumId: string,
  chapterId: string,
  userMessage: string,
): Promise<{ assistantReply: string; state: ChapterState; chapterId: string }> {
  return postJson(`/api/v2/albums/${albumId}/chapter-chat`, { chapterId, userMessage });
}

// POST /finalize — async (202). Flips the album to AGENT_RUNNING ("completing");
// the completed callback writes album_pages + layout_json. No body.
export function postFinalize(
  albumId: string,
): Promise<{ albumId: string; requestId: string; accepted: true }> {
  return postJson(`/api/v2/albums/${albumId}/finalize`);
}
