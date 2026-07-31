'use client';

/* ════════════════════════════════════════════════════════════════════════════
   AI 对话(设计 Agent 改书)—— 移动端那一份。

   为什么不挂桌面 ChatPanel:它依赖 ChatCoordinatorContext(由 EditorBook 挂载时填充),
   移动端这棵独立树没有那套上下文,整体挂进来会炸。所以这里是一个**瘦客户端**,直连
   与桌面同一个端点:
     POST /api/v3/albums/{uuid}/design-chat?stream=1   NDJSON 事件流
     GET  /api/v1/albums/{uuid}/messages               历史回放

   两个关键处置:
   · 走流式:一轮可能跑到 120s(多工具 + 模型往返)。非流式就是「按了发送之后一片死寂」,
     手机上尤其像卡死。流式能把 tool_call/tool_result 变成一句「正在…」。
   · done 事件在 committed 时**直接带回新的 pages** —— 原地换书即可,不必重拉草稿,
     不闪屏、也不会把用户没保存的本地改动冲掉。
   ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useRef, useState } from 'react';

import type { EditorPage } from '../../types';
import {
  buildChatHistory,
  designOpCategories,
  mergeChatHistory,
  type ChatHistoryItem,
  type ChatRole,
} from '../chat-history';

export type { ChatRole };

/** 与桌面回放同一形状(见 ../chat-history):渲染各写各的,口径共用一份。 */
export type ChatMessage = ChatHistoryItem;

export type ChatStatus =
  /** 空闲。 */
  | { kind: 'idle' }
  /** 在跑:label 是给用户看的一句「正在…」。 */
  | { kind: 'busy'; label: string }
  | { kind: 'error'; message: string };

/** 六个写工具 → 一句人话。与桌面 DESIGN_CHANGE_CATEGORY 同一批工具名。 */
const TOOL_LABEL: Record<string, { zh: string; en: string }> = {
  update_page_texts: { zh: '正在改文字…', en: 'Updating text…' },
  write_page_html: { zh: '正在调整版面…', en: 'Adjusting layout…' },
  swap_page_template: { zh: '正在换版式…', en: 'Swapping template…' },
  update_page_images: { zh: '正在换图…', en: 'Updating photos…' },
  set_text_colors: { zh: '正在调颜色…', en: 'Adjusting colours…' },
  set_text_fonts: { zh: '正在调字体…', en: 'Adjusting fonts…' },
  read_page: { zh: '正在读这一页…', en: 'Reading the page…' },
  read_book: { zh: '正在通读整本…', en: 'Reading the book…' },
};

function toolLabel(name: string, zh: boolean): string {
  const hit = TOOL_LABEL[name];
  if (hit) return zh ? hit.zh : hit.en;
  return zh ? '正在处理…' : 'Working…';
}

let localSeq = 0;
const nextId = () => `local-${(localSeq += 1)}`;

export function useDesignChat(albumId: string, zh: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>({ kind: 'idle' });
  const busy = useRef(false);
  /** 「在飞中」守卫。防的是连点两下气泡打两次请求,**不是**永久闸门 —— 早先那版用
   *  load-once,于是桌面/另一棵壳里后来聊的内容在手机上永远看不到。 */
  const loadingHistory = useRef(false);

  /**
   * 每次打开对话都拉一次历史(与桌面同一张表,两端看到的是同一段对话)。
   *
   * 合并而不是覆盖:design chat 一轮可能跑到 120s,落库在 done 事件。这期间本地那条
   * 「刚发出去的话」还没进库,整体覆盖会让它当场消失。判重口径见 mergeChatHistory。
   */
  const loadHistory = useCallback(async () => {
    if (loadingHistory.current) return;
    loadingHistory.current = true;
    try {
      const res = await fetch(`/api/v1/albums/${albumId}/messages?limit=50`);
      const json = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            data?: {
              messages?: { id: string; role: string; content: string; layoutPatch?: unknown }[];
            };
          }
        | null;
      const server = buildChatHistory(json?.data?.messages ?? []);
      setMessages((local) => mergeChatHistory(server, local));
    } catch {
      /* 历史拉不到不该挡住发新消息 —— 静默,下次打开再试 */
    } finally {
      loadingHistory.current = false;
    }
  }, [albumId]);

  /**
   * 发一轮。
   * @param onPages committed 时把新书交回去(原地换,不重拉草稿)
   */
  const send = useCallback(
    async (
      text: string,
      currentPageIndex: number | null,
      onPages: (pages: EditorPage[]) => void,
    ) => {
      const body = text.trim();
      if (!body || busy.current) return;
      busy.current = true;
      setMessages((m) => [...m, { id: nextId(), role: 'user', text: body, changes: [] }]);
      setStatus({ kind: 'busy', label: zh ? '正在思考…' : 'Thinking…' });
      // 这一轮成功跑过的写工具。落库时路由自己也收一份进 layout_patch.designOps;
      // 这里收是为了**实时**那条回复就带上「已更新」条,不必等下次回放才长出来。
      const writeTools: string[] = [];
      try {
        const res = await fetch(`/api/v3/albums/${albumId}/design-chat?stream=1`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userMessage: body,
            ...(currentPageIndex != null ? { currentPageIndex } : {}),
          }),
        });
        if (!res.ok || !res.body) throw new Error(`design-chat ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let done = false;

        const handle = (line: string) => {
          const t = line.trim();
          if (!t) return;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(t) as Record<string, unknown>;
          } catch {
            return; // 半行/噪声,忽略
          }
          if (ev.type === 'tool_call' && typeof ev.toolName === 'string') {
            writeTools.push(ev.toolName);
            setStatus({ kind: 'busy', label: toolLabel(ev.toolName, zh) });
            return;
          }
          if (ev.type === 'error') {
            throw new Error(typeof ev.error === 'string' ? ev.error : 'stream error');
          }
          if (ev.type === 'done') {
            done = true;
            const r = (ev.response ?? {}) as {
              assistantReply?: unknown;
              committed?: unknown;
              pages?: unknown;
            };
            const reply = typeof r.assistantReply === 'string' ? r.assistantReply.trim() : '';
            const committed = r.committed === true;
            // **一轮结束必须有反馈。** AI 有时只动手不说话(改完了但没写文字),
            // 早先的写法是「有文字才加气泡」→ 那种轮次用户看到的是:发出去了、状态消失了、
            // 屏幕上什么都没多 —— 分不清是成功还是石沉大海。
            const text =
              reply ||
              (committed
                ? zh
                  ? '已经按你说的改好了。'
                  : 'Done — I made those changes.'
                : zh
                  ? '这次没有改动。'
                  : 'No changes this time.');
            setMessages((m) => [
              ...m,
              {
                id: nextId(),
                role: 'assistant',
                text,
                // 只有真改了东西才有「已更新」条;read_page / read_book 折不出类别,自然为空。
                changes: committed ? designOpCategories(writeTools) : [],
              },
            ]);
            // committed 才带 pages;原地换书,画板立刻反映 AI 的改动。
            if (committed && Array.isArray(r.pages)) {
              onPages(
                (r.pages as Record<string, unknown>[]).map((p, i) => ({
                  pageIndex: typeof p.pageIndex === 'number' ? p.pageIndex : i,
                  templateId: String(p.templateId ?? ''),
                  imagesJson: (p.images ?? {}) as Record<string, string>,
                  textsJson: (p.texts ?? {}) as Record<string, string>,
                  imagePosJson: (p.imagePos ?? {}) as EditorPage['imagePosJson'],
                  htmlJson: typeof p.html === 'string' ? p.html : undefined,
                })),
              );
            }
          }
        };

        for (;;) {
          const { done: fin, value } = await reader.read();
          if (fin) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const l of lines) handle(l);
        }
        buf += decoder.decode();
        if (buf.trim()) handle(buf);

        // 流断了却没收到 done = 这一轮没跑完,必须说话,不能装作成功。
        if (!done) throw new Error('stream ended without done');
        setStatus({ kind: 'idle' });
      } catch (e) {
        setStatus({
          kind: 'error',
          message: zh ? '这一轮没成功,再试一次' : "That didn't go through — try again",
        });
        void e;
      } finally {
        busy.current = false;
      }
    },
    [albumId, zh],
  );

  return { messages, status, send, loadHistory };
}
