// editor-canvas-context 的单测:四个查询器 + 两处易漏语义。
// 有了它,以后改查询器不用挂载 5,700 行的编辑器才能验证。
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCanvasQuery } from './editor-canvas-context';

// Node 里没有 CSS.escape(它是浏览器 API)。按规范做一个最小替身:
// 只转义以数字开头的标识符与前导特殊字符,够覆盖 byId 的单测意图。
// 未定义时 byId 会抛 ReferenceError —— 那正是它在浏览器外的真实行为。
const cssEscape = (s: string) => s.replace(/^(\d)/, '\\3$1 ').replace(/([:.\\])/g, '\\$1');

type FakeEl = { closest: (sel: string) => boolean; id?: string };

function fakeRoot(handlers: {
  querySelector?: (s: string) => FakeEl | null;
  querySelectorAll?: (s: string) => FakeEl[];
}) {
  return {
    querySelector: handlers.querySelector ?? (() => null),
    querySelectorAll: handlers.querySelectorAll ?? (() => []),
  } as unknown as HTMLElement;
}

describe('createCanvasQuery', () => {
  it('$ 返回 root.querySelector 的结果(HTMLElement | null)', () => {
    const el = { closest: () => false } as FakeEl;
    const q = createCanvasQuery(fakeRoot({ querySelector: () => el }));
    assert.equal(q.$('.x'), el as unknown as HTMLElement);
  });

  it('byId 对 id 做 CSS.escape —— 模板 id 含冒号时不做会抛 SyntaxError', () => {
    const prev = (globalThis as unknown as { CSS?: { escape: (s: string) => string } }).CSS;
    (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = { escape: cssEscape };
    try {
      let seen = '';
      const q = createCanvasQuery(
        fakeRoot({
          querySelector: (s) => {
            seen = s;
            return null;
          },
        }),
      );
      q.byId('tpl:cover.v2');
      assert.ok(seen.startsWith('#'), '必须以 # 开头');
      assert.ok(seen.includes('\\'), `id 里的冒号/点必须被转义,实际:${seen}`);
    } finally {
      (globalThis as unknown as { CSS?: unknown }).CSS = prev;
    }
  });

  it('$$scoped 排掉 .pane-chat-col 子树(ChatPanel 自己绑,这里不能双绑)', () => {
    const inChat = { closest: (sel: string) => sel === '.pane-chat-col' } as FakeEl;
    const canvas = { closest: () => false } as FakeEl;
    const q = createCanvasQuery(fakeRoot({ querySelectorAll: () => [canvas, inChat] }));
    const got = q.$$scoped('[data-action]');
    assert.equal(got.length, 1, '对话栏子树必须被排掉');
    assert.equal(got[0], canvas as unknown as Element);
  });

  it('$$ 原样返回 querySelectorAll 结果(不做过滤)', () => {
    const a = { closest: () => false } as FakeEl;
    const b = { closest: (sel: string) => sel === '.pane-chat-col' } as FakeEl;
    const q = createCanvasQuery(fakeRoot({ querySelectorAll: () => [a, b] }));
    assert.equal(q.$$('.y').length, 2);
  });
});
