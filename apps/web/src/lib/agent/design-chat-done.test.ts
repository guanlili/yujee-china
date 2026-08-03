import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { buildDesignDonePayload } from './design-chat-done';

// design-agent 的写工具(move_pages/delete_page)只动 pages 数组顺序、不改页对象的
// pageIndex 字段。落库侧 persistDesignChat 已按数组序重编号(2026-08-03 修复),但
// done 事件回给浏览器的那份此前是原始数组 —— 桌面 replacePages / 移动 onPages 原样
// 采纳后,编辑器「数组下标 == pageIndex」的不变式被打破:选中/改字/删页全部按
// pageIndex 寻址,从此打错页,下一轮 currentPageIndex 也报错页(用户看到的就是
// 「挪着挪着全乱了」)。这里锁死:回浏览器的 pages 与落库同口径,按数组序重编号。

test('committed 轮:pages 按数组序重编号 pageIndex,顺序与其余字段原样保留', () => {
  const payload = buildDesignDonePayload({
    assistant: { text: '挪好了' },
    committed: true,
    book: {
      pages: [
        { pageIndex: 0, templateId: 'cover-a', texts: { title: '封面' } },
        { pageIndex: 3, templateId: 'interior-b', texts: { t: '原第4页' } },
        { pageIndex: 1, templateId: 'interior-a', texts: { t: '原第2页' } },
        { pageIndex: 2, templateId: 'ending-a', texts: {} },
      ],
    },
  });
  assert.equal(payload.assistantReply, '挪好了');
  assert.equal(payload.committed, true);
  assert.deepEqual(
    payload.pages.map((p) => (p as { pageIndex: number }).pageIndex),
    [0, 1, 2, 3],
  );
  // 数组顺序是唯一真相:重编号不许换序,内容字段一个不动。
  assert.deepEqual(
    payload.pages.map((p) => (p as { templateId: string }).templateId),
    ['cover-a', 'interior-b', 'interior-a', 'ending-a'],
  );
  assert.deepEqual((payload.pages[1] as { texts: unknown }).texts, { t: '原第4页' });
});

test('未 committed / book.pages 缺失:pages 为空数组,不炸', () => {
  const payload = buildDesignDonePayload({ assistant: { text: 'hi' }, committed: false });
  assert.equal(payload.committed, false);
  assert.deepEqual(payload.pages, []);
});

test('非对象页条目原样透传(垃圾数据留给落库侧 Page.parse 拒绝,这里不吞不炸)', () => {
  const payload = buildDesignDonePayload({
    committed: true,
    book: { pages: [{ pageIndex: 9, templateId: 'a' }, 'garbage'] },
  });
  assert.equal((payload.pages[0] as { pageIndex: number }).pageIndex, 0);
  assert.equal(payload.pages[1], 'garbage');
});

test('assistant.text 非字符串时回退空串', () => {
  const payload = buildDesignDonePayload({ assistant: { text: 42 }, committed: true });
  assert.equal(payload.assistantReply, '');
});

// 接线守卫:route 的 done 处理必须经 buildDesignDonePayload 取 pages(落库与回发同一份
// 重编号结果),不许再直接摸 response.book.pages 原始数组。
test('design-chat 路由的 done 事件走 buildDesignDonePayload,不再直发原始 book.pages', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const routeSrc = readFileSync(
    join(here, '..', '..', 'app', 'api', 'v3', 'albums', '[uuid]', 'design-chat', 'route.ts'),
    'utf8',
  );
  assert.match(routeSrc, /buildDesignDonePayload/);
  assert.doesNotMatch(routeSrc, /Array\.isArray\(response\.book\?\.pages\)/);
});
