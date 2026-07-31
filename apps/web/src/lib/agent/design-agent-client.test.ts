import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const clientSource = readFileSync(join(here, 'design-agent-client.ts'), 'utf8');
const routeSource = readFileSync(
  join(here, '../../app/api/v3/albums/[uuid]/design-chat/route.ts'),
  'utf8',
);

// 一次 design-chat 调用里,预算是**顺序累加**的:先 loadBook 装书,再跑对话轮次,
// 最后还要留出 persistDesignChat 落库的时间。断言最大值会漏掉这个结构 ——
// 把 loadBook 调到 60s 也照样绿,而真实最坏情况已经越界。
const HEADROOM_MS = 30_000; // 鉴权 + 读 draft + done 之后的 persistDesignChat

function budget(label: string, pattern: RegExp): number {
  const matched = pattern.exec(clientSource);
  assert.ok(matched, `没能从 design-agent-client.ts 解析出 ${label} 的超时,测试本身已失效`);
  return Number(matched[1]!.replace(/_/g, ''));
}

test('design-chat 一次调用的顺序预算总和必须放得进路由的 maxDuration', () => {
  const maxDuration = /export const maxDuration = (\d+)/.exec(routeSource);
  assert.ok(maxDuration, 'design-chat route 必须显式声明 maxDuration');
  const budgetMs = Number(maxDuration[1]) * 1000;

  const loadBookMs = budget('loadBook', /postDesign\('\/api\/book',[\s\S]*?,\s*(\d[\d_]*)\)/);
  const streamChatMs = budget('chatStream', /AbortSignal\.timeout\((\d[\d_]*)\)/);
  const syncChatMs = budget('chat', /postDesign\('\/api\/chat',[\s\S]*?,\s*(\d[\d_]*)\)/);

  // 流式与非流式两条路径都是 loadBook 之后再跑一轮对话,取更慢的那条。
  const worstMs = loadBookMs + Math.max(streamChatMs, syncChatMs) + HEADROOM_MS;

  assert.ok(
    worstMs <= budgetMs,
    `最坏顺序预算 ${worstMs}ms(装书 ${loadBookMs} + 对话 ${Math.max(streamChatMs, syncChatMs)} + ` +
      `余量 ${HEADROOM_MS})超过函数预算 ${budgetMs}ms —— 慢轮次会被 Vercel 在 maxDuration 处` +
      '直接杀掉,done 之后的 persistDesignChat 可能来不及落库',
  );
});
