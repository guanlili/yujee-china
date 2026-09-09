import { z } from 'zod';
import { requireRealUser } from '@/lib/auth/require-auth';
import { parseBody } from '@/lib/api/zod-parse';
import { ok } from '@/lib/api/ok';
import { fromException } from '@/lib/api/from-exception';
import { albumService } from '@/services/album/album-service';
import { designAgentClient } from '@/lib/agent/design-agent-client';
import { buildDesignDonePayload, type DesignDoneResponse } from '@/lib/agent/design-chat-done';

// 写类工具：其操作在历史里以「更新了什么」彩色条呈现，需随 assistant 消息落库（存 layout_patch
// 的 designOps）。必须覆盖全部 10 个写工具 —— set_text_fonts / write_page_html 过去漏在集合外，
// 导致历史回放里字体/HTML 更新丢失、彩色条少报；set_page_background / apply_book_style
// 是风格理解那一批新加的两个（2026-08-29）。类别映射见 chat-history.ts 的 DESIGN_CHANGE_CATEGORY。
const DESIGN_WRITE_TOOLS = new Set([
  'update_page_texts',
  'write_page_html',
  'swap_page_template',
  'update_page_images',
  'set_text_colors',
  'set_page_background',
  'apply_book_style',
  'set_text_fonts',
  'move_pages',
  'delete_page',
  // 2026-09-09 照片视觉档案那批:构图裁切 / 整本调色 / 逐张抠图。
  // look_at_photos 是读工具,不进这里 —— 它不改任何东西。
  'set_image_pos',
  'set_photo_filter',
  'set_photo_cutout',
]);

// 设计 Agent 全书对话。默认同步 JSON；?stream=1 时把 8787 的 NDJSON 事件流逐行
// 转发给浏览器（tool_call/tool_result 实时可见），在 done 事件时服务端先落库
// （pages 写回 draft_json + 聊天历史进 album_messages）再转发精简版结果。
const BodySchema = z
  .object({
    userMessage: z.string().min(1).max(500),
    // 用户当前停留的编辑器页(可选):透传给设计 agent 消解"这页"类指代。
    currentPageIndex: z.number().int().min(0).optional(),
  })
  .strict();

// 多工具轮次（读页 + 写入 + 模型往返）可能超过 60s。
//
// 这个预算必须放得下**顺序累加**的整条链路：prepareDesignChat 的 loadBook(15s)
// → 对话轮次(240s) → done 之后的 persistDesignChat 落库。不变量由
// design-agent-client.test.ts 锁住，别只盯着单个超时值改。
//
// 倒挂（客户端等待 ≥ 本预算）时的后果，2026-07-31 线上故障就是这个形状：
// Vercel 在 maxDuration 处直接杀掉函数，流断在半路；因为响应头在流开始时就已发出，
// 这条请求在 Vercel 日志里记成 200，错误只藏在日志条目的 logs 字段里，几乎查不出来。
// 更糟的是 persistDesignChat 跟 done 事件在同一次调用里，函数被杀会让 AI 说了"改好了"
// 而写库丢失。
//
// 注意别误解客户端超时的落点：AbortSignal.timeout 传给 fetch 会连响应体一起中断，
// 所以流式路径上超时是在下面的 reader.read() 抛出、被转成流内 error 事件的，
// 走不到 chatStream 的 catch —— AGENT_TIMEOUT/504 只对非流式路径生效。
//
// 300 是本项目 Vercel Fluid compute 的上限（项目 API: functionDefaultTimeout=300）。
export const maxDuration = 300;

export async function POST(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const user = await requireRealUser(req);
    const { uuid } = await ctx.params;
    const body = await parseBody(BodySchema, req);
    const stream = new URL(req.url).searchParams.get('stream') === '1';

    if (!stream) {
      const result = await albumService.designChatTurn(user.id, uuid, {
        userMessage: body.userMessage,
        currentPageIndex: body.currentPageIndex,
      });
      return ok(result);
    }

    await albumService.prepareDesignChat(user.id, uuid);
    const upstream = await designAgentClient.chatStream(uuid, body.userMessage, body.currentPageIndex);
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
          // pages 按数组序重编号 pageIndex(理由见 design-chat-done.ts 抬头):落库与
          // 回发浏览器必须是同一份重编号结果,否则挪页/删页后浏览器书状态的 pageIndex
          // 与数组序错位,画板一切按 pageIndex 寻址的操作从此打错页。
          const { assistantReply, committed, pages, photoFilterPatch } = buildDesignDonePayload(
            (event.response ?? {}) as DesignDoneResponse,
          );
          const appliedFilter = await albumService.persistDesignChat(user.id, uuid, {
            userMessage: body.userMessage,
            assistantReply,
            committed,
            pages,
            ops: writeOps,
            // 滤镜独立于 committed:只调色不改版面的一轮 committed 是 false,
            // 但 albums.photo_filter 照样要落(理由见 persistDesignChat 的注释)。
            photoFilterPatch,
          });
          emit({
            type: 'done',
            // committed 时把新页一并回给前端，用于画板原地重绘（无重挂闪屏）；未 committed 不带。
            response: {
              assistantReply,
              committed,
              pageCount: pages.length,
              ...(committed ? { pages } : {}),
              // 落库后的权威滤镜状态。滤镜引擎只在 Browser 跑,画板拿不到新值就
              // 还是旧观感 —— 而滤镜不进 book.version,committed 为 false 的一轮
              // 也可能改了它,所以这一项独立于上面的 pages。
              ...(appliedFilter ? { photoFilter: appliedFilter.photoFilter, settingsRevision: appliedFilter.settingsRevision } : {}),
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
