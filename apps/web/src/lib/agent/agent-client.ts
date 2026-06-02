import { env } from '@/lib/env';
import { ERRORS } from '@/lib/api/error-codes';
import { logger } from '@/lib/log/logger';
import type { AlbumLayoutPlanT } from '@/lib/agent/layout-schema';

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
};
