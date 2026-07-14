'use client';

import { UnauthorizedError, CreditInsufficientError } from '@/lib/generation/client';

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
  // 页面 HTML 真相(C 方案):画板优先渲染;图片 src 为 {{IMG_SRC}} token。
  htmlJson?: string;
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
  // 本章照片(从 tree.chapters[].photos 取)。排版前 pages 还不存在,收集面板的章节卡片
  // 靠它显示缩略图 + 触发 select-layout 时凑全 photoIds。
  photoIds: string[];
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
  // draft/story-progress 是随排版/编辑不断变化的动态数据,绝不能吃缓存 —— 否则原地重取
  // (排版完成后刷画板)会命中 collect 阶段那次 0 页的旧响应,画板一直空(#layout-refresh)。
  const res = await fetch(path, { cache: 'no-store' });
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

// 内容采集(分组后采访)— 把每章采访答案拼成的 chapterContext 存回 draft_json.tree(§3 数据
// 归属:tree 不经浏览器往返,浏览器只发拼好的答案字符串)。纯 draft 写回,不调 Agent、不推进
// stage。PRIVACY:chapterContext 只含地名文字 + 用户原话,坐标止步于浏览器(见 lib/photo/geocode)。
// 跳过的章不必出现在数组里。
export interface ChapterContextEntry {
  chapterId: string;
  chapterContext: string;
}
export interface ChapterInterviewMessage {
  chapterId: string;
  role: 'user' | 'assistant';
  content: string;
}
export function postChapterContexts(
  albumId: string,
  contexts: ChapterContextEntry[],
  messages?: ChapterInterviewMessage[],
): Promise<{ savedChapterIds: string[] }> {
  return postJson(`/api/v3/albums/${albumId}/chapter-context`, { contexts, ...(messages?.length ? { messages } : {}) });
}

// 采访要用「章→photoIds」把每章对回 clusterId → 取预填。复用只读的章节摘要端点
// (getChapterSummary),它返回派生摘要(label/role/photoIds),不含可编辑树(不变式 12)。
export interface ChapterSummaryEntry {
  chapterId: string;
  label: string;
  role: string;
  photoIds: string[];
  // 采访门槛:该章的 chapterContext(采访答案拼出的章节背景),非空 ⇔ 已采访过。
  chapterContext: string;
}
export function fetchChapterSummary(albumId: string): Promise<{ chapters: ChapterSummaryEntry[] }> {
  return getJson(`/api/v1/albums/${albumId}/chapters`);
}

// 设计 Agent 全书对话（design-chat 路由）。committed=true 表示 pages 已在服务端写回
// draft_json —— 前端只需派发 yujee:authoring-pages-ready 让画板重取草稿。
export interface DesignChatResult {
  assistantReply: string;
  committed: boolean;
  pageCount: number;
}

export function postDesignChat(
  albumId: string,
  input: { userMessage: string },
): Promise<DesignChatResult> {
  return postJson(`/api/v3/albums/${albumId}/design-chat`, input);
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
