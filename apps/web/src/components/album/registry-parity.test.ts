import assert from 'node:assert/strict';
import test from 'node:test';

import { TEMPLATE_IDS } from '@yujee/contracts/templates';
import { WEB_TEMPLATE_REGISTRY } from './web-registry';

// 矢量 PDF 导出已退役(C 方案:页面真相 = HTML,导出走栅格截屏)。
// 渲染真相只剩 web 注册表,这里守住它对 TEMPLATES 的全覆盖:漏一个 id,编辑器
// 和导出(栅格截屏渲染的就是 web 模板)就同时白屏。
test('every template id has a web renderer', () => {
  for (const id of TEMPLATE_IDS) {
    assert.ok(WEB_TEMPLATE_REGISTRY[id], `${id} is missing a web renderer`);
  }
});

test('no orphan web renderer without a registered template', () => {
  const ids = new Set<string>(TEMPLATE_IDS);
  for (const id of Object.keys(WEB_TEMPLATE_REGISTRY)) {
    assert.ok(ids.has(id), `web renderer "${id}" has no template in the registry`);
  }
});
