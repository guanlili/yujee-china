import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const routeSource = readFileSync(join(here, 'route.ts'), 'utf8');

test('生图路由要求真实登录用户 —— 游客余额是 0,但更要紧的是别给匿名账号开生成入口', () => {
  assert.match(routeSource, /requireRealUser/);
});

test('入参过 GenerateImageBodySchema —— 尺寸和描述长度是上游账单的闸门', () => {
  assert.match(routeSource, /GenerateImageBodySchema/);
  assert.match(routeSource, /parseBody\(/);
});

test('相册 id 取自路由参数,不取自 body —— 否则用户能往别人的相册里写图', () => {
  assert.match(routeSource, /ctx\.params/);
  assert.match(routeSource, /albumId: uuid/);
  assert.doesNotMatch(routeSource, /albumId: body\./);
});

test('交给 service,不在路由里编排扣费', () => {
  assert.match(routeSource, /imageGenerationService\.generate/);
  assert.doesNotMatch(routeSource, /applyDelta|creditService/);
});

test('异常统一走 fromException —— 错误码映射不在这层各写一遍', () => {
  assert.match(routeSource, /fromException/);
});
