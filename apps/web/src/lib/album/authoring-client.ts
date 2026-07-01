'use client';

import { UnauthorizedError, CreditInsufficientError } from '@/lib/generation/client';
import type {
  V3ChatTurn,
  V3ChapterChatResponse,
  V3EditChatResponse,
  V3RecommendResponse,
  V3ChapterThemeChoice,
} from '@yujee/contracts';

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
  // The chapter's title (optional theme `subject`, persisted into an empty title slot at
  // apply-theme, #236). Absent/empty until the theme stage runs — fall back to `label`.
  subject?: string;
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

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) {
    // Same typed-error posture as the generation client so the editor can redirect
    // to login / surface the buy-credits card instead of dumping a raw message.
    if (res.status === 401 || json.error?.code === 'UNAUTHORIZED') throw new UnauthorizedError();
    if (json.error?.code === 'CREDIT_INSUFFICIENT') throw new CreditInsufficientError();
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

// A page patch the browser folds into pagesState via applyPatchToPages
// (imagesJson/textsJson/templateId) — the apply-theme / cover stages repaint the
// canvas with it. Mirrors the chapter-chat edit-turn mapping.
export interface BrowserLayoutPatchEntry {
  pageIndex: number;
  templateId?: string;
  imagesJson?: Record<string, string>;
  textsJson?: Record<string, string>;
}

// ③ 主题/章节色 · 推荐 — one real /v3/recommend turn (缺口#20). Invariant 12 / §3 数据归属:
// the browser holds NO authoring tree, so it sends ONLY its language (+ an optional
// free-text nudge); the Web route re-slices the per-chapter overview from draft_json
// server-side. Returns three book theme options. Nothing is written — apply-theme writes
// the tree + title slots after the user selects one option.
export function postRecommend(
  albumId: string,
  userMessage?: string,
  fontHint?: string,
): Promise<V3RecommendResponse> {
  return postJson(`/api/v3/albums/${albumId}/recommend`, {
    language: 'en',
    ...(userMessage !== undefined ? { userMessage } : {}),
    ...(fontHint !== undefined ? { fontHint } : {}),
  });
}

// ③ 主题/章节色 · 应用 — one real /v3/apply-theme turn (缺口#20). Invariant 12 / §3 数据
// 归属: the browser holds NO layout pages, so it sends ONLY its SELECTIONS (per-chapter
// {subject, accentColor, artFont}); the Web service re-slices each chapter's themable
// pages from draft_json server-side, runs the deterministic brush, writes the tree
// color/font + persists each subject into its chapter title slot (#236) + advances stage
// theme→cover. Returns the page-level layoutPatch the browser applies live + new stage.
export interface ApplyThemeInput {
  chapters: V3ChapterThemeChoice[];
}
export function postApplyTheme(
  albumId: string,
  input: ApplyThemeInput,
): Promise<{ stage: string; layoutPatch: BrowserLayoutPatchEntry[]; assistantReply?: string }> {
  return postJson(`/api/v3/albums/${albumId}/apply-theme`, {
    language: 'en',
    chapters: input.chapters,
  });
}

// 内容采集(分组后采访)— 把每章采访答案拼成的 chapterContext 存回 draft_json.tree(§3 数据
// 归属:tree 不经浏览器往返,浏览器只发拼好的答案字符串)。纯 draft 写回,不调 Agent、不推进
// stage。PRIVACY:chapterContext 只含地名文字 + 用户原话,坐标止步于浏览器(见 lib/photo/geocode)。
// 跳过的章不必出现在数组里。
export interface ChapterContextEntry {
  chapterId: string;
  chapterContext: string;
}
export function postChapterContexts(
  albumId: string,
  contexts: ChapterContextEntry[],
): Promise<{ savedChapterIds: string[] }> {
  return postJson(`/api/v3/albums/${albumId}/chapter-context`, { contexts });
}

// ④ 书籍设计 — 封面/封尾 — one real /v3/cover turn (缺口#20). Invariant 12 / §3 数据归属:
// the browser holds NO layout pages, so it sends ONLY its SELECTIONS (the chosen 封面/封尾
// template ids, or null = 跳过 — 封面可选 §4.4); the Web service re-slices the relevant
// pages from draft_json server-side, runs the deterministic auto-fill, folds the patch
// into draft_json.pages + advances stage cover→ready. A skip returns an EMPTY patch and
// never errors. Returns the browser-shaped layoutPatch to apply live + the new stage.
// `coverPhotoId`/`endingPhotoId` (optional) let the user pick WHICH photo sits on the
// cover/ending hero. They never touch the Agent /v3/cover contract: the Web service swaps
// the chosen photo into the re-sliced cover/ending page BEFORE forwarding to the stateless
// agent (which auto-fills from the page's own images). Absent = keep whatever analyze put
// there (book's first/last photo).
export interface CoverInput {
  coverTemplateId?: string | null;
  endingTemplateId?: string | null;
  coverPhotoId?: string | null;
  endingPhotoId?: string | null;
  coverPhoto?: string;
  endingPhoto?: string;
  userMessage?: string;
  history?: V3ChatTurn[];
}
export function postCover(
  albumId: string,
  input: CoverInput,
): Promise<{ stage: string; layoutPatch: BrowserLayoutPatchEntry[]; assistantReply?: string; needsUserInput?: boolean }> {
  return postJson(`/api/v3/albums/${albumId}/cover`, {
    language: 'en',
    ...(input.coverTemplateId !== undefined ? { coverTemplateId: input.coverTemplateId } : {}),
    ...(input.endingTemplateId !== undefined ? { endingTemplateId: input.endingTemplateId } : {}),
    ...(input.coverPhotoId !== undefined ? { coverPhotoId: input.coverPhotoId } : {}),
    ...(input.endingPhotoId !== undefined ? { endingPhotoId: input.endingPhotoId } : {}),
    ...(input.coverPhoto !== undefined ? { coverPhoto: input.coverPhoto } : {}),
    ...(input.endingPhoto !== undefined ? { endingPhoto: input.endingPhoto } : {}),
    ...(input.userMessage !== undefined ? { userMessage: input.userMessage } : {}),
    ...(input.history !== undefined ? { history: input.history } : {}),
  });
}

// ② 章节故事 — one real /v3/chapter-chat turn (缺口#20). Invariant 12 / §3 数据归属:
// the browser holds NO authoring tree, so it sends ONLY the chapter it's on (chapterId)
// + history + userMessage (+ the focused page); the Web route re-slices draft_json
// server-side into the single-chapter V3ChapterChatRequest the agent needs. Returns the
// agent's turn verbatim: kind=talk/write/edit + assistantReply, plus pagesTexts (write),
// layoutPatch (edit), nameOptions (chapter-title chips). The caller applies the patch by
// kind (talk NEVER carries one — Frame 4 红线 is enforced agent-side via the contract).
export interface ChapterChatInput {
  language: 'zh' | 'en';
  chapterId: string;
  history: V3ChatTurn[];
  userMessage: string;
  focusedPageIndex?: number;
}
export function postChapterChat(
  albumId: string,
  input: ChapterChatInput,
): Promise<V3ChapterChatResponse> {
  return postJson(`/api/v3/albums/${albumId}/chapter-chat`, input);
}

export interface EditChatInput {
  language: 'zh' | 'en';
  chapterId?: string;
  userMessage: string;
  focusedPageIndex?: number;
  pagePhotoRefs?: Record<string, string>;
}

export function postEditChat(albumId: string, input: EditChatInput): Promise<V3EditChatResponse> {
  return postJson(`/api/v3/albums/${albumId}/edit-chat`, input);
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
