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
  // #165 per-slot position/scale overrides. Absent => render default 50/50/1.
  imagePosJson?: Record<string, { x: number; y: number; scale: number }>;
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

// A pickable theme candidate proposed before a theme is fixed (editor.html
// themeOpt1-3). Display-only (invariant 12) — the server never merges these into
// draft_json; picking one just sends its label back as the next /theme nudge.
export interface ThemeOption {
  subject: string;
  label: string;
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
): Promise<{ theme: unknown; assistantReply: string; themeOptions?: ThemeOption[] }> {
  return postJson(`/api/v2/albums/${albumId}/theme`, userMessage ? { userMessage } : {});
}

// POST /chapter-chat — synchronous. Sends the chapterId + the user's message; the
// server slices that chapter and merges the reply back into draft_json.
export function postChapterChat(
  albumId: string,
  chapterId: string,
  userMessage: string,
): Promise<{ assistantReply: string; state: ChapterState; chapterId: string; nameOptions?: string[] }> {
  return postJson(`/api/v2/albums/${albumId}/chapter-chat`, { chapterId, userMessage });
}

// POST /finalize — async (202). Flips the album to AGENT_RUNNING ("completing");
// the completed callback writes album_pages + layout_json. No body.
export function postFinalize(
  albumId: string,
): Promise<{ albumId: string; requestId: string; accepted: true }> {
  return postJson(`/api/v2/albums/${albumId}/finalize`);
}

// POST /draft-edit — synchronous (#162). The draft-period chat path: send the
// FLAT pageIndex the user is looking at + their message; the server slices that
// one page (invariant 12) and either talks back (kind:'talk') or rewrites that
// page's copy (kind:'act' + the merged pageWrite to repaint locally).
export interface DraftEditResult {
  kind: 'talk' | 'act' | 'inspect';
  assistantReply: string;
  // kind:'act' via write_page_copy — the page's rewritten copy to repaint.
  pageWrite?: { pageIndex: number; texts: Record<string, string> };
  // kind:'act' via adjust_image_position (#165 Phase 3) — the single per-image
  // {x,y,scale} to fold into the page's imagePosJson[imageId]. Already persisted
  // server-side; the browser mirrors it locally + repaints.
  imagePosWrite?: { pageIndex: number; imageId: string; x: number; y: number; scale: number };
  // kind:'inspect' (#165 Phase 3) — the model wants to SEE the page; the browser
  // screenshots it → /inspect-render → diagnosis → re-issues draft-edit.
  inspectRequest?: { pageIndex: number };
}
export function postDraftEdit(
  albumId: string,
  pageIndex: number,
  userMessage: string,
): Promise<DraftEditResult> {
  return postJson(`/api/v2/albums/${albumId}/draft-edit`, { pageIndex, userMessage });
}

// #165 Phase 3 — per-image position/scale diagnosis from a vision pass.
// #169: the diagnosis now carries the ABSOLUTE target object-position the subject
// should sit at (targetX/targetY ∈ [0,100], same space as ImagePos.x/y), not a
// relative dx/dy shift.
export interface InspectDiagnosis {
  imageId?: string | null;
  problem: string;
  targetX: number;
  targetY: number;
  suggestedScale: number;
  confidence: number;
}
export interface InspectRenderResult {
  diagnosis: InspectDiagnosis;
  assistantReply: string;
}
// POST /inspect-render — synchronous (#165 Phase 3). Send the FLAT pageIndex + the
// user's message + a screenshot data URI of the rendered page; the server slices
// that one page (invariant 12), runs ONE vision call, and returns the crop
// diagnosis + reply. The screenshot is never persisted/logged (invariant 1/2).
export function postInspectRender(
  albumId: string,
  pageIndex: number,
  userMessage: string,
  screenshot: string,
): Promise<InspectRenderResult> {
  return postJson(`/api/v2/albums/${albumId}/inspect-render`, { pageIndex, userMessage, screenshot });
}
