'use client';

import { UnauthorizedError } from '@/lib/generation/client';

// Browser-side client for the V3 authoring surface. The read-only draft skeleton
// remains server-derived from draft_json; legacy draft chat endpoints were removed
// with the V2 teardown, so old free-text helpers return a local guidance message.

// ── Draft skeleton (GET /api/v3/albums/[uuid]/draft) ──
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

const V3_AUTHORING_GUIDANCE =
  'Draft chat was retired with the legacy generation flow. Continue with the V3 chapter confirmation, theme, cover, and export steps.';

// GET the read-only skeleton. `draft` is null when the album isn't in the draft
// phase (no draft, or already finalized — layout_json set).
export function fetchDraftSkeleton(albumId: string): Promise<{ draft: DraftSkeleton | null }> {
  return getJson(`/api/v3/albums/${albumId}/draft`);
}

export function postTheme(
  _albumId: string,
  _userMessage?: string,
): Promise<{ theme: unknown; assistantReply: string; themeOptions?: ThemeOption[] }> {
  return Promise.resolve({ theme: null, assistantReply: V3_AUTHORING_GUIDANCE });
}

export function postChapterChat(
  _albumId: string,
  chapterId: string,
  _userMessage: string,
): Promise<{ assistantReply: string; state: ChapterState; chapterId: string; nameOptions?: string[] }> {
  return Promise.resolve({ assistantReply: V3_AUTHORING_GUIDANCE, state: 'generated', chapterId });
}

export function postFinalize(
  albumId: string,
): Promise<{ albumId: string; requestId: string; accepted: true }> {
  return Promise.resolve({ albumId, requestId: crypto.randomUUID(), accepted: true });
}

// Legacy draft-period free-text editing is no longer backed by Agent V2.
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
  _albumId: string,
  _pageIndex: number,
  _userMessage: string,
): Promise<DraftEditResult> {
  return Promise.resolve({ kind: 'talk', assistantReply: V3_AUTHORING_GUIDANCE });
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
export function postInspectRender(
  _albumId: string,
  _pageIndex: number,
  _userMessage: string,
  _screenshot: string,
): Promise<InspectRenderResult> {
  return Promise.resolve({
    diagnosis: {
      problem: 'Legacy draft inspection is no longer available.',
      targetX: 50,
      targetY: 50,
      suggestedScale: 1,
      confidence: 0,
    },
    assistantReply: V3_AUTHORING_GUIDANCE,
  });
}
