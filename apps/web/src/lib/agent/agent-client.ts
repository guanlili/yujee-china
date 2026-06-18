import { env } from '@/lib/env';
import { ERRORS } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';
import {
  // Response zod (value) + inferred type share the name — used for both runtime
  // validation and typing. Truth source: packages/contracts/src/v2.ts (T0 #113).
  V2ThemeResponse,
  V2ChapterChatResponse,
  V2EditResponse,
  V2DraftEditResponse,
  V2InspectResponse,
} from '@yujee/contracts';
import type {
  V2InitRequest,
  V2FinalizeRequest,
  V2AddPhotosRequest,
  V2ThemeRequest,
  V2ChapterChatRequest,
  V2EditRequest,
  V2DraftEditRequest,
  V2InspectRequest,
  V3AnalyzeRequest,
} from '@yujee/contracts';

export type AgentPhotoInput = {
  photoId: string;
  base64: string;
  width: number;
  height: number;
};

// A patch entry is a partial Page (docs/agent/contract.md §2.2). Field names are
// `images`/`texts` — the same as the Page schema — per the B9 agent output. The
// shape is shared with the v2 edit contract (LayoutPatchEntry in v2.ts).
export type LayoutPatchEntry = {
  pageIndex: number;
  templateId?: string;
  images?: Record<string, string>;
  texts?: Record<string, string>;
  // Per-slot position/scale overrides (#165). Mirrors @yujee/contracts
  // LayoutPatchEntry.imagePos — without it the finalize-era chat-edit path
  // (applyPatch/toBrowserPatch) would silently strip an override (#165 D1).
  imagePos?: Record<string, { x: number; y: number; scale: number }>;
};

export const agentClient = {
  // ──────────────────────────── v3 (五环节状态机) ────────────────────────────
  // POST /v3/analyze — async 202 + callback to /api/v3/internal/job-progress
  // (WP1.1, docs/agent/v3-requirements.md §8). The only v3 endpoint carrying
  // base64, so it mirrors submitInitV2's 30s submit window: a cross-region
  // multi-MB body must not abort before the agent's fast 202 (else web wrongly
  // marks the job FAILED while the agent keeps analysing). The bg task callbacks
  // progress → completed/failed later. The route parses V3AnalyzeRequest before
  // calling, so this forwards an already-validated body. AGENT_SHARED_SECRET only
  // — never bundled to the client (§3 secret).
  async submitAnalyzeV3(payload: V3AnalyzeRequest): Promise<{ requestId: string }> {
    let res: Response;
    try {
      res = await fetch(`${env.AGENT_BASE_URL}/v3/analyze`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AGENT_SHARED_SECRET}`,
          'Content-Type': 'application/json',
          'X-Request-Id': payload.requestId,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      logger.error({ err: String(e), requestId: payload.requestId }, 'agent v3 analyze submit failed');
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }
    if (res.status === 401) throw ERRORS.AGENT_UNAUTHORIZED();
    if (res.status === 400) throw ERRORS.VALIDATION_FAILED('agent rejected analyze payload');
    if (!res.ok) {
      logger.error({ status: res.status, requestId: payload.requestId }, 'agent v3 analyze non-2xx');
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }
    return { requestId: payload.requestId };
  },

  // ──────────────────────────── v2 (agent rebuild) ────────────────────────────
  // The v2 surface forwards already-validated contract bodies (the route parses
  // V2*Request before calling). init/finalize are async (202 + callback to
  // /api/v2/internal/job-progress); theme/chapter-chat/edit are synchronous.
  // docs/agent/rebuild-tech-plan.md §1.1–§1.5.

  // POST /v2/album/init — async 202. The only v2 endpoint carrying base64, so it
  // gets a 30s timeout: a cross-region multi-MB body must not abort before the
  // agent's fast 202 (else web wrongly marks the job FAILED while the agent keeps
  // running). The bg task callbacks later.
  async submitInitV2(payload: V2InitRequest): Promise<{ requestId: string }> {
    let res: Response;
    try {
      res = await fetch(`${env.AGENT_BASE_URL}/v2/album/init`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AGENT_SHARED_SECRET}`,
          'Content-Type': 'application/json',
          'X-Request-Id': payload.requestId,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      logger.error({ err: String(e), requestId: payload.requestId }, 'agent v2 init submit failed');
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }
    if (res.status === 401) throw ERRORS.AGENT_UNAUTHORIZED();
    if (res.status === 400) throw ERRORS.VALIDATION_FAILED('agent rejected init payload');
    if (!res.ok) {
      logger.error({ status: res.status, requestId: payload.requestId }, 'agent v2 init non-2xx');
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }
    return { requestId: payload.requestId };
  },

  // POST /v2/album/add-photos — async 202 (W11 mid-edit add). Carries base64 for the
  // NEW photos only, so the same 30s window as init. Completed callback carries the
  // new pages + photo analyses to splice before the existing ending.
  async submitAddPhotosV2(payload: V2AddPhotosRequest): Promise<{ requestId: string }> {
    let res: Response;
    try {
      res = await fetch(`${env.AGENT_BASE_URL}/v2/album/add-photos`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AGENT_SHARED_SECRET}`,
          'Content-Type': 'application/json',
          'X-Request-Id': payload.requestId,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      logger.error({ err: String(e), requestId: payload.requestId }, 'agent v2 add-photos submit failed');
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }
    if (res.status === 401) throw ERRORS.AGENT_UNAUTHORIZED();
    if (res.status === 400) throw ERRORS.VALIDATION_FAILED('agent rejected add-photos payload');
    if (!res.ok) {
      logger.error({ status: res.status, requestId: payload.requestId }, 'agent v2 add-photos non-2xx');
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }
    return { requestId: payload.requestId };
  },

  // POST /v2/album/finalize — async 202. Body is the whole authoring tree (no
  // base64), still cross-region, so keep the 30s submit window. Completed callback
  // carries the flat AlbumLayoutPlan (invariant 12: the tree never crosses out).
  async submitFinalizeV2(payload: V2FinalizeRequest): Promise<{ requestId: string }> {
    let res: Response;
    try {
      res = await fetch(`${env.AGENT_BASE_URL}/v2/album/finalize`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AGENT_SHARED_SECRET}`,
          'Content-Type': 'application/json',
          'X-Request-Id': payload.requestId,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      logger.error({ err: String(e), requestId: payload.requestId }, 'agent v2 finalize submit failed');
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }
    if (res.status === 401) throw ERRORS.AGENT_UNAUTHORIZED();
    if (res.status === 400) throw ERRORS.VALIDATION_FAILED('agent rejected finalize payload');
    if (!res.ok) {
      logger.error({ status: res.status, requestId: payload.requestId }, 'agent v2 finalize non-2xx');
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }
    return { requestId: payload.requestId };
  },

  // POST /v2/album/theme — synchronous, user waits. Returns the proposed theme +
  // optional cover draft. 60s, no retry (same as chatEdit). Response validated
  // against the contract so a drifted agent can't poison draft_json.
  async themeV2(payload: V2ThemeRequest): Promise<V2ThemeResponse> {
    return postSyncV2('/v2/album/theme', payload, V2ThemeResponse, { albumId: payload.albumId });
  },

  // POST /v2/album/chapter-chat — synchronous. Only the one chapter slice goes out
  // (architecture §3); returns the assistant reply + advanced state + page texts.
  async chapterChatV2(payload: V2ChapterChatRequest): Promise<V2ChapterChatResponse> {
    return postSyncV2('/v2/album/chapter-chat', payload, V2ChapterChatResponse, {
      albumId: payload.albumId,
    });
  },

  // POST /v2/album/edit — synchronous, operates on the finalized flat layout.
  // Returns a layoutPatch (≤48 entries).
  async editV2(payload: V2EditRequest): Promise<V2EditResponse> {
    return postSyncV2('/v2/album/edit', payload, V2EditResponse, { albumId: payload.albumId });
  },

  // POST /v2/album/draft-edit — synchronous (#162). Draft-period "render first
  // version + pointed single-page edit", with talk/act physically split. The
  // payload carries ONLY the single focused page slice + that page's photo
  // analyses (no base64, no whole tree — invariant 12). Returns kind:'talk'
  // (assistant reply only) or kind:'act' (+ pageWrite to apply to that page).
  async draftEditV2(payload: V2DraftEditRequest): Promise<V2DraftEditResponse> {
    return postSyncV2('/v2/album/draft-edit', payload, V2DraftEditResponse, {
      albumId: payload.albumId,
    });
  },

  // POST /v2/album/inspect-page — synchronous (#165 Phase 3). After draft-edit
  // returns kind:'inspect', the browser screenshots the rendered page and posts it
  // here; the agent runs ONE vision call (doubao-1.6-vision, same model/key as
  // init) and returns a crop diagnosis + move/zoom suggestion. The `screenshot`
  // base64 lives only in the request body (invariant 1/2 — not logged/stored).
  async inspectRenderV2(payload: V2InspectRequest): Promise<V2InspectResponse> {
    return postSyncV2('/v2/album/inspect-page', payload, V2InspectResponse, {
      albumId: payload.albumId,
    });
  },
};

// Shared tail for the three synchronous v2 endpoints: POST, unwrap the
// { ok, data } envelope, and validate `data` against the
// contract schema. A schema miss is AGENT_INVALID_OUTPUT — the agent answered but
// off-contract, distinct from a transport failure (AGENT_CHAT_FAILED).
async function postSyncV2<T>(
  path: string,
  payload: unknown,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  logCtx: Record<string, unknown>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.AGENT_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AGENT_SHARED_SECRET}`,
        'Content-Type': 'application/json',
        'X-Request-Id': crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    logger.error({ err: String(e), path, ...logCtx }, 'agent v2 sync call failed');
    throw ERRORS.AGENT_CHAT_FAILED();
  }
  if (res.status === 401) throw ERRORS.AGENT_UNAUTHORIZED();
  if (!res.ok) {
    logger.error({ status: res.status, path, ...logCtx }, 'agent v2 sync non-2xx');
    throw ERRORS.AGENT_CHAT_FAILED();
  }
  const json = await res.json();
  if (!json.ok) throw ERRORS.AGENT_CHAT_FAILED();
  const parsed = schema.safeParse(json.data);
  if (!parsed.success) {
    logger.error({ path, ...logCtx }, 'agent v2 sync response off-contract');
    throw ERRORS.AGENT_INVALID_OUTPUT();
  }
  return parsed.data;
}
