import { env } from '@/lib/env';
import { ERRORS } from '@/lib/api/error-codes';

// 设计 Agent（packages/design-agent album server）客户端。与 agentClient 分开：
// base/协议都不同（直接 JSON 响应，不是 {ok,data} 信封；书状态随响应带回）。
// 服务端专用 —— 必须在 API 路由/service 里调用，不能进浏览器。

interface DesignAgentBookPayload {
  chapters: unknown[];
  pages: unknown[];
  // 书级设计简报(主题/配色主题/封面氛围)—— chapter 概念不进 AI 上下文的替代语境。
  brief?: { theme?: string; palette?: { fonts?: Record<string, string>; colors?: Record<string, string> }; coverMood?: string };
  // 全书滤镜/抠图现状(albums.photo_filter 那一列)。Agent 读它来判断当前调色,
  // 改动经由 /api/chat 响应的 photoFilterPatch 带回,由 web 落库 —— agent 不写库。
  photoFilter?: unknown;
}

// 相册级语境:不属于书本身,但决定 Agent 能做什么/该提醒什么。每轮装书都重传
// (分享状态、可看图的照片集合在两轮之间都会变)。
interface DesignAgentAlbumContext {
  /** 这本书发布过分享链接吗 —— 为真时 Agent 改滤镜要提醒用户重新备份全书。 */
  hasPublishedShare?: boolean;
  /** 有 R2 原图可看的照片(look_at_photos 取得到的那批)。不传图本身:几十张 base64 太贵。 */
  viewablePhotoIds?: string[];
}

export interface DesignAgentChatResult {
  assistantReply: string;
  committed: boolean;
  book: { pages: unknown[]; version: number };
  /** 本轮累计的滤镜/抠图 patch;没动过是 null。落库口径见 design-chat-done.ts 的注释。 */
  photoFilterPatch: Record<string, unknown> | null;
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
  // 流式对话：返回原始 NDJSON Response（body 为 design-agent 的事件流），由调用方
  // （design-chat 路由）逐行转发给浏览器并在 done 事件时落库。
  async chatStream(albumId: string, message: string, currentPageIndex?: number): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${env.DESIGN_AGENT_BASE_URL}/api/chat?stream=1`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(env.DESIGN_AGENT_SHARED_SECRET
            ? { Authorization: `Bearer ${env.DESIGN_AGENT_SHARED_SECRET}` }
            : {}),
        },
        // currentPageIndex:用户在编辑器里停留的页,供 agent 消解"这页"类指代。
        body: JSON.stringify({ albumId, message, currentPageIndex }),
        signal: AbortSignal.timeout(240_000),
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'TimeoutError') throw ERRORS.AGENT_TIMEOUT();
      throw ERRORS.AGENT_INTERNAL_ERROR();
    }
    if (!res.ok || !res.body) {
      if (res.status === 401) throw ERRORS.AGENT_UNAUTHORIZED();
      throw ERRORS.AGENT_CHAT_FAILED();
    }
    return res;
  },

  // 装书：Web 的 draft（tree.chapters + pages）→ Agent 画布。每轮对话前调用，
  // 保证 Agent 看到的书永远是 Postgres 里的最新真相。
  async loadBook(
    albumId: string,
    book: DesignAgentBookPayload,
    context: DesignAgentAlbumContext = {},
  ): Promise<void> {
    // 相册语境走顶层而不是塞进 book —— book 的形状是 Agent 的书契约,掺进
    // 「这本书分享过没有」这类相册属性会污染它。
    // ⚠️ postDesign 这一行**保持单行**:design-agent-client.test.ts 的顺序预算守卫
    // 靠源码正则解析这里的超时值,拆行会让它解析不到、当场判定"测试本身已失效"。
    const payload = {
      albumId,
      book,
      hasPublishedShare: context.hasPublishedShare === true,
      viewablePhotoIds: context.viewablePhotoIds ?? [],
    };
    await postDesign('/api/book', payload, 15_000);
  },

  async chat(
    albumId: string,
    message: string,
    currentPageIndex?: number,
  ): Promise<DesignAgentChatResult> {
    const raw = await postDesign('/api/chat', { albumId, message, currentPageIndex }, 240_000);
    const assistant = raw.assistant as { text?: unknown } | undefined;
    const book = raw.book as { pages?: unknown; version?: unknown } | undefined;
    if (typeof assistant?.text !== 'string' || !Array.isArray(book?.pages)) {
      throw ERRORS.AGENT_INVALID_OUTPUT();
    }
    const patch = raw.photoFilterPatch;
    return {
      assistantReply: assistant.text,
      committed: raw.committed === true,
      book: {
        pages: book.pages,
        version: typeof book.version === 'number' ? book.version : 0,
      },
      // 滤镜不进 book.version,所以它与 committed 互相独立 —— 别拿 committed 判断
      // 要不要落滤镜(只调色不改版面的一轮 committed 是 false)。
      photoFilterPatch:
        patch && typeof patch === 'object' && !Array.isArray(patch)
          ? (patch as Record<string, unknown>)
          : null,
    };
  },
};
