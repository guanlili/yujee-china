import { env } from '@/lib/env';
import { ERRORS } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';
import type { AlbumLayoutPlanT } from '@/lib/agent/layout-schema';
import {
  // Response zod (value) + inferred type share the name — used for both runtime
  // validation and typing. Truth source: packages/contracts/src/v2.ts (T0 #113).
  V2ThemeResponse,
  V2ChapterChatResponse,
  V2EditResponse,
} from '@yujee/contracts';
import type {
  V2InitRequest,
  V2FinalizeRequest,
  V2ThemeRequest,
  V2ChapterChatRequest,
  V2EditRequest,
} from '@yujee/contracts';

export type AgentPhotoInput = {
  photoId: string;
  base64: string;
  width: number;
  height: number;
};

export type AgentLayoutRequest = {
  requestId: string;
  prompt: string;
  language: 'zh' | 'en';
  callbackUrl: string;
  photos: AgentPhotoInput[];
};

export type ChatHistoryItem = { role: 'user' | 'assistant'; content: string };

// A patch entry is a partial Page (docs/agent/contract.md §2.2). Field names are
// `images`/`texts` — the same as the Page schema — per the B9 agent output.
export type LayoutPatchEntry = {
  pageIndex: number;
  templateId?: string;
  images?: Record<string, string>;
  texts?: Record<string, string>;
};

export type ChatEditRequest = {
  albumId: string;
  currentLayout: AlbumLayoutPlanT;
  history: ChatHistoryItem[];
  userMessage: string;
  language: 'zh' | 'en';
};

export type ChatEditResult = {
  layoutPatch: LayoutPatchEntry[];
  assistantReply: string;
  usage?: unknown;
};

export const agentClient = {
  async submitLayout(payload: AgentLayoutRequest): Promise<{ requestId: string }> {
    let res: Response;
    try {
      res = await fetch(`${env.AGENT_BASE_URL}/v1/layout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AGENT_SHARED_SECRET}`,
          'Content-Type': 'application/json',
          'X-Request-Id': payload.requestId,
        },
        body: JSON.stringify(payload),
        // 30s, not 8s: the body carries 1-30 base64 photos (~2MB) forwarded
        // Vercel→Fly cross-region. 8s aborted before the agent's fast 202 came
        // back (agent had already accepted + started the bg task), so web
        // wrongly marked the job FAILED while the agent kept running.
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      logger.error({ err: String(e), requestId: payload.requestId }, 'agent submit failed');
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }
    if (res.status === 401) throw ERRORS.AGENT_UNAUTHORIZED();
    if (res.status === 400) throw ERRORS.VALIDATION_FAILED('agent rejected payload');
    if (!res.ok) {
      logger.error({ status: res.status, requestId: payload.requestId }, 'agent non-2xx');
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }
    return { requestId: payload.requestId };
  },

  // Synchronous: the user waits in the chat box. Returns layoutPatch +
  // assistantReply (docs/agent/contract.md §2.2). 60s timeout — no retry.
  async chatEdit(payload: ChatEditRequest): Promise<ChatEditResult> {
    let res: Response;
    try {
      res = await fetch(`${env.AGENT_BASE_URL}/v1/chat-edit`, {
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
      logger.error({ err: String(e), albumId: payload.albumId }, 'agent chat-edit failed');
      throw ERRORS.AGENT_CHAT_FAILED();
    }
    if (res.status === 401) throw ERRORS.AGENT_UNAUTHORIZED();
    if (!res.ok) {
      logger.error({ status: res.status, albumId: payload.albumId }, 'agent chat-edit non-2xx');
      throw ERRORS.AGENT_CHAT_FAILED();
    }
    const json = await res.json();
    if (!json.ok) throw ERRORS.AGENT_CHAT_FAILED();
    return json.data as ChatEditResult;
  },

  // ──────────────────────────── v2 (agent rebuild) ────────────────────────────
  // The v2 surface forwards already-validated contract bodies (the route parses
  // V2*Request before calling). init/finalize are async (202 + callback to
  // /api/v2/internal/job-progress); theme/chapter-chat/edit are synchronous.
  // docs/agent/rebuild-tech-plan.md §1.1–§1.5.

  // POST /v2/album/init — async 202. The only v2 endpoint carrying base64, so the
  // same 30s timeout as submitLayout (a cross-region multi-MB body must not abort
  // before the agent's fast 202; see submitLayout). The bg task callbacks later.
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
  // Superset of /v1/chat-edit; returns a layoutPatch (≤48 entries).
  async editV2(payload: V2EditRequest): Promise<V2EditResponse> {
    return postSyncV2('/v2/album/edit', payload, V2EditResponse, { albumId: payload.albumId });
  },
};

// Shared tail for the three synchronous v2 endpoints: POST, unwrap the
// { ok, data } envelope (same as v1 chatEdit), and validate `data` against the
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
