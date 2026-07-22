import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 成稿的灵魂是「照片以真图进 Gemini 上下文」。缩略图存在浏览器 IndexedDB 里,换浏览器 /
// 清站点数据 / 跨设备继续做的时候拿不到,refs 就是空 —— 此时整本书零张真图进模型,
// 模型只能凭章标题和采访原话写。这是**静默退化**,前端必须留一条 warn,否则生产上
// 只能靠 Agent 侧的 compose.chapter_without_images 反推。
// ChatPanel 是一大坨命令式 DOM effect(无 jsdom harness),沿用本目录的源码断言风格。
const here = dirname(fileURLToPath(import.meta.url));
const chatSrc = readFileSync(join(here, 'ChatPanel.tsx'), 'utf8');

// runApplyDesign 函数体(到下一个顶层 `    function ` / `    async function ` 为止)。
function applyDesignBody(): string {
  const start = chatSrc.indexOf('async function runApplyDesign');
  assert.ok(start > 0, '找不到 runApplyDesign');
  const rest = chatSrc.slice(start + 10);
  const end = rest.search(/\n {4}(?:async )?function /);
  return rest.slice(0, end > 0 ? end : undefined);
}

test('一张缩略图都拿不到就提交成稿时,留下一条 warn', () => {
  const body = applyDesignBody();
  assert.match(body, /console\.warn\(\s*'\[compose\] no photo refs/);
  // 只是可观测性,不改行为:拿不到缩略图仍然照常提交(不 return、不抛)。
  assert.match(body, /refs\s*\}\)/);
});
