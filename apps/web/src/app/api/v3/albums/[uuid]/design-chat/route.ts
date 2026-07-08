import { z } from 'zod';
import { requireAuth } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';
import { designAgentClient } from '@/lib/agent/design-agent-client';

// 写类工具：其操作在历史里以 op-card 呈现，需随 assistant 消息落库（存 layout_patch）。
const DESIGN_WRITE_TOOLS = new Set([
  'update_page_texts',
  'swap_page_template',
  'update_page_images',
  'set_text_colors',
]);

// 设计 Agent 全书对话。默认同步 JSON；?stream=1 时把 8787 的 NDJSON 事件流逐行
// 转发给浏览器（tool_call/tool_result 实时可见），在 done 事件时服务端先落库
// （pages 写回 draft_json + 聊天历史进 album_messages）再转发精简版结果。
const BodySchema = z
  .object({
    userMessage: z.string().min(1).max(500),
  })
  .strict();

// 多工具轮次（读页 + 写入 + 模型往返）可能超过 60s。
export const maxDuration = 120;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireAuth(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const stream = new URL(req.url).searchParams.get('stream') === '1';

    if (!stream) {
      const result = await albumService.designChatTurn(user.id, uuid, {
        userMessage: body.userMessage,
      });
      return ok(result);
    }

    await albumService.prepareDesignChat(user.id, uuid);
    const upstream = await designAgentClient.chatStream(uuid, body.userMessage);
    const encoder = new TextEncoder();
    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: unknown) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };
        const reader = upstream.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        // 收集成功执行的写类操作（{toolName, input}），随 assistant 消息落库供历史回放。
        const pendingWrite = new Map<string, { toolName: string; input: unknown }>();
        const writeOps: Array<{ toolName: string; input: unknown }> = [];
        const handleLine = async (line: string) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          const event = JSON.parse(trimmed) as Record<string, unknown>;
          if (event.type !== 'done') {
            emit(event);
            const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : '';
            if (event.type === 'tool_call' && typeof event.toolName === 'string' && DESIGN_WRITE_TOOLS.has(event.toolName)) {
              pendingWrite.set(toolCallId, { toolName: event.toolName, input: event.input });
            } else if (event.type === 'tool_result' && event.isError !== true) {
              const op = pendingWrite.get(toolCallId);
              if (op) writeOps.push(op);
            }
            return;
          }
          const response = (event.response ?? {}) as {
            assistant?: { text?: unknown };
            committed?: unknown;
            book?: { pages?: unknown };
          };
          const assistantReply =
            typeof response.assistant?.text === 'string' ? response.assistant.text : '';
          const committed = response.committed === true;
          const pages = Array.isArray(response.book?.pages) ? response.book.pages : [];
          await albumService.persistDesignChat(user.id, uuid, {
            userMessage: body.userMessage,
            assistantReply,
            committed,
            pages,
            ops: writeOps,
          });
          emit({
            type: 'done',
            // committed 时把新页一并回给前端，用于画板原地重绘（无重挂闪屏）；未 committed 不带。
            response: {
              assistantReply,
              committed,
              pageCount: pages.length,
              ...(committed ? { pages } : {}),
            },
          });
        };
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) await handleLine(line);
          }
          buffer += decoder.decode();
          if (buffer.trim()) await handleLine(buffer);
        } catch (e) {
          emit({ type: 'error', error: e instanceof Error ? e.message : String(e) });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(readable, {
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/x-ndjson; charset=utf-8',
        'x-accel-buffering': 'no',
      },
    });
  } catch (e) {
    return fromException(e);
  }
}
