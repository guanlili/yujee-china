import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 成稿(④ compose)是全链路唯一的 AI 调用,10 章的书跑过 5 分钟完全正常。前端等成稿的
// 封顶必须和服务端 COMPOSE_ZOMBIE_TIMEOUT_MS(12 分钟)同档,而且封顶到点也不该判定失败:
// 旧行为是 t=300s 撤掉封面回执卡 + 说「没跑成」,几十秒后书又出现,撤掉的 recap 不会重建。
// ChatPanel 是一大坨命令式 DOM effect(无 jsdom harness),沿用本目录的源码断言风格。
const here = dirname(fileURLToPath(import.meta.url));
const chatSrc = readFileSync(join(here, 'ChatPanel.tsx'), 'utf8');
const jobSrc = readFileSync(
  join(here, '..', '..', '..', 'services', 'job', 'job-service.ts'),
  'utf8',
);

// waitForComposeThenRefresh 函数体(到下一个顶层 `    function ` / `    async function ` 为止)。
function composeWaitBody(): string {
  const start = chatSrc.indexOf('async function waitForComposeThenRefresh');
  assert.ok(start > 0, '找不到 waitForComposeThenRefresh');
  const rest = chatSrc.slice(start + 10);
  const end = rest.search(/\n {4}(?:async )?function /);
  return rest.slice(0, end > 0 ? end : undefined);
}

test('前端等成稿的封顶与服务端 compose 僵尸超时同档(12 分钟)', () => {
  assert.match(composeWaitBody(), /12 \* 60 \* 1000/);
  assert.doesNotMatch(composeWaitBody(), /5 \* 60 \* 1000/);
  // 服务端那一档也确实是 12 分钟(两处同改的锚点)。
  assert.match(jobSrc, /COMPOSE_ZOMBIE_TIMEOUT_MS = 12 \* 60 \* 1000/);
});

test('等到封顶不判定失败:不撤回执卡、不说没跑成、不重新给选择卡', () => {
  const body = composeWaitBody();
  assert.doesNotMatch(body, /recap\?\.remove\(\)/);
  assert.doesNotMatch(body, /设计这步没跑成/);
  assert.doesNotMatch(body, /designOfferShown = false/);
  // 改成「还在写,稍后回来看看」这类不判定失败的文案。
  assert.match(body, /还在写/);
});
