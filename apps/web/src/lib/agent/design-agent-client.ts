import { env } from '@/lib/env';
import { ERRORS } from '@/lib/api/error-codes';

// 设计 Agent（packages/design-agent album server）客户端。与 agentClient 分开：
// base/协议都不同（直接 JSON 响应，不是 {ok,data} 信封；书状态随响应带回）。
// 服务端专用 —— 必须在 API 路由/service 里调用，不能进浏览器。

interface DesignAgentBookPayload {
  chapters: unknown[];
  pages: unknown[];
}

export interface DesignAgentChatResult {
  assistantReply: string;
  committed: boolean;
  book: { pages: unknown[]; version: number };
}

async function postDesign(path: string, payload: unknown, timeoutMs: number): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${env.DESIGN_AGENT_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.DESIGN_AGENT_SHARED_SECRET
          ? { Authorization: `Bearer ${env.DESIGN_AGENT_SHARED_SECRET}` }
          : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') throw ERRORS.AGENT_TIMEOUT();
    throw ERRORS.AGENT_INTERNAL_ERROR();
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    if (res.status === 401) throw ERRORS.AGENT_UNAUTHORIZED();
    if (res.status === 400 || res.status === 409 || res.status === 422) {
      const detail = Array.isArray(json?.details) ? `：${json.details.slice(0, 3).join('；')}` : '';
      throw ERRORS.VALIDATION_FAILED(
        `${typeof json?.error === 'string' ? json.error : 'design agent rejected the payload'}${detail}`,
      );
    }
    throw ERRORS.AGENT_CHAT_FAILED();
  }
  if (!json) throw ERRORS.AGENT_INVALID_OUTPUT();
  return json;
}

export const designAgentClient = {
  // 装书：Web 的 draft（tree.chapters + pages）→ Agent 画布。每轮对话前调用，
  // 保证 Agent 看到的书永远是 Postgres 里的最新真相。
  async loadBook(albumId: string, book: DesignAgentBookPayload): Promise<void> {
    await postDesign('/api/book', { albumId, book }, 15_000);
  },

  async chat(albumId: string, message: string): Promise<DesignAgentChatResult> {
    const raw = await postDesign('/api/chat', { albumId, message }, 180_000);
    const assistant = raw.assistant as { text?: unknown } | undefined;
    const book = raw.book as { pages?: unknown; version?: unknown } | undefined;
    if (typeof assistant?.text !== 'string' || !Array.isArray(book?.pages)) {
      throw ERRORS.AGENT_INVALID_OUTPUT();
    }
    return {
      assistantReply: assistant.text,
      committed: raw.committed === true,
      book: {
        pages: book.pages,
        version: typeof book.version === 'number' ? book.version : 0,
      },
    };
  },
};
