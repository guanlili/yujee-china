import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChatHistory,
  designChangeCategoryOf,
  designOpCategories,
  mergeChatHistory,
} from './chat-history';

/* 历史回放的口径必须只有一份。桌面 ChatPanel.loadHistory 与移动 useDesignChat.loadHistory
   过去各写各的,移动那份把所有行原样当纯文本铺出来 —— 于是同一段对话在两棵壳里长得不一样。
   这些测试钉住共用口径;渲染层(DOM / JSX)各自实现,但「哪些行算历史、每行带什么」在这里定。 */

test('跳过 [inspection of page 内部行(与桌面 ChatPanel 同口径)', () => {
  const out = buildChatHistory([
    { id: 'a', role: 'user', content: '[inspection of page 3] ...' },
    { id: 'b', role: 'user', content: '把标题改大一点' },
  ]);
  assert.deepEqual(out.map((m) => m.id), ['b'], '巡检内部行不是对话内容,不该出现在历史里');
});

test('assistant 行带出 designOps 类别(去重 + 固定顺序 字体→颜色→页面)', () => {
  const out = buildChatHistory([
    {
      id: 'a',
      role: 'assistant',
      content: '改好了',
      layoutPatch: {
        designOps: [
          { toolName: 'update_page_texts' },
          { toolName: 'set_text_fonts' },
          { toolName: 'write_page_html' },
        ],
      },
    },
  ]);
  assert.deepEqual(
    out[0]?.changes,
    ['fonts', 'pages'],
    '两个 pages 类工具要去重成一个,且顺序固定为 字体→颜色→页面',
  );
});

test('move_pages 归入 order 类别,与其余写工具类别并存', () => {
  assert.equal(designChangeCategoryOf('move_pages'), 'order');
  assert.deepEqual(designOpCategories(['move_pages', 'set_text_fonts']), ['fonts', 'order']);
});

test('delete_page 归入 pages 类别(2026-08-03 删除书页落地)', () => {
  assert.equal(designChangeCategoryOf('delete_page'), 'pages');
  assert.deepEqual(designOpCategories(['delete_page', 'move_pages']), ['pages', 'order']);
});

test('历史到达不抹掉本地还没落库的消息(回归:setMessages(rows) 整体覆盖)', () => {
  // design chat 一轮要跑到 120s,落库在 done 事件。这期间用户看到的那条「刚发出去的话」
  // 只在本地。历史请求晚一步回来时整体覆盖 → 用户眼睁睁看着自己刚发的消息消失。
  const local = [
    { id: 'local-1', role: 'user' as const, text: '把封面换成第二张', changes: [] },
  ];
  const server = buildChatHistory([{ id: 'srv-1', role: 'user', content: '之前聊的' }]);

  const out = mergeChatHistory(server, local);

  assert.deepEqual(
    out.map((m) => m.text),
    ['之前聊的', '把封面换成第二张'],
    '服务端历史在前,本地未落库的消息接在后面,一条都不能少',
  );
});

test('已经落库的本地消息不重复出现(按 role+text 认同一条)', () => {
  const local = [{ id: 'local-1', role: 'user' as const, text: '把封面换成第二张', changes: [] }];
  const server = buildChatHistory([
    { id: 'srv-1', role: 'user', content: '之前聊的' },
    { id: 'srv-2', role: 'user', content: '把封面换成第二张' },
  ]);

  const out = mergeChatHistory(server, local);

  assert.deepEqual(
    out.map((m) => m.text),
    ['之前聊的', '把封面换成第二张'],
    '这一轮落库后再拉历史,本地那条已经在服务端了,不该并排出现两遍',
  );
});

test('重复文本按条数配对,不是按集合去重(否则连发两条一样的话会少一条)', () => {
  // 用户连着说了两次「再来一次」,但只有第一条落了库(第二轮还在飞)。
  const local = [
    { id: 'local-1', role: 'user' as const, text: '再来一次', changes: [] },
    { id: 'local-2', role: 'user' as const, text: '再来一次', changes: [] },
  ];
  const server = buildChatHistory([{ id: 'srv-1', role: 'user', content: '再来一次' }]);

  const out = mergeChatHistory(server, local);

  assert.equal(out.length, 2, '服务端一条 + 本地还没落库的那条 = 两条,不能被集合去重吃掉一条');
});
