// 触控尺寸的单一来源 + 防回归。
//
// 背景(2026-11-11):两轨手写 CSS 里的触控尺寸全靠字面量,没有 token 层,也没有
// 任何检查 —— 于是 30×30 的关闭按钮一直存在而没人发现。这个测试做两件事:
//   1. 锁住 editor-tokens 里的尺寸 token(值被改小 = 触控退化,直接红)
//   2. 兜底扫描:任何 width/height 都是 30px 的「控件类」规则,必须有 ::after
//      补热区,否则新增一个 30×30 小按钮就会立刻被拦下,而不是等线上点不中。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const css = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const tokens = css('./editor-tokens.css');
const port = css('./editor-port.css');

/** 取所有「选择器 { body }」对(够用即可,不追求完整 CSS 解析)。 */
function rules(src: string): Array<{ sel: string; body: string }> {
  const out: Array<{ sel: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push({ sel: m[1].trim(), body: m[2] });
  return out;
}

const all = rules(port);
const selOf = (predicate: (r: { sel: string; body: string }) => boolean) => all.filter(predicate);

describe('触控尺寸 token', () => {
  it('editor-tokens 定义 --touch-min: 44px(不得改小)', () => {
    const m = /--touch-min:\s*(\d+)px/.exec(tokens);
    assert.ok(m, '--touch-min 必须存在');
    assert.ok(Number(m[1]) >= 44, `--touch-min 不得小于 44px,当前 ${m[1]}px`);
  });

  it('--ctl-close + 2×|--touch-spread| >= --touch-min(30 + 14 = 44)', () => {
    const close = Number(/--ctl-close:\s*(\d+)px/.exec(tokens)?.[1]);
    const spread = Number(/--touch-spread:\s*-(\d+)px/.exec(tokens)?.[1]);
    assert.ok(close > 0 && spread > 0, '两个 token 都要存在');
    assert.ok(close + spread * 2 >= 44, `视觉 ${close}px + 热区 ${spread * 2}px 不足 44px`);
  });
});

describe('已知小控件都补了热区', () => {
  for (const name of ['.collage-close', '.board-bg-close', '.zoom-btn']) {
    it(`${name} 有 ::after 热区`, () => {
      const hit = selOf((r) => r.sel.includes(name) && r.sel.includes('::after') && /inset:/.test(r.body));
      assert.ok(hit.length > 0, `${name} 缺 ::after { inset: ... } 热区 —— 视觉可以小,可点区域不能小`);
    });
  }

  it('视觉尺寸走 token,而不是再次写死 30px', () => {
    const close = selOf((r) => r.sel.startsWith('.editor-port .collage-close') && r.body.includes('width:var(--ctl-close)'));
    assert.ok(close.length > 0, 'collage-close 的宽高应引用 --ctl-close');
  });
});

describe('兜底:新增的 30×30 控件必须带热区', () => {
  it('所有 width:30px;height:30px 的控件类规则都有对应 ::after', () => {
    const suspects = all.filter((r) => {
      const b = r.body.replace(/\s/g, '');
      const is30 = /width:30px/.test(b) && /height:30px/.test(b);
      const looksControl = /close|btn|button|icon|zoom/.test(r.sel);
      return is30 && looksControl;
    });
    const missing = suspects.filter((r) => {
      // 按「选择器末段的类名」匹配:`.view-ctrl .zoom-btn` 的热区通常写在基类
      // `.editor-port .zoom-btn::after` 上,用整串选择器比会误报。
      const lastClass = r.sel.split(',')[0].trim().split(/\s+/).pop() ?? r.sel;
      return !all.some((x) => x.sel.includes(lastClass) && x.sel.includes('::after') && /inset:/.test(x.body));
    });
    assert.equal(
      missing.length,
      0,
      `这些 30×30 控件没有补热区:${missing.map((m) => m.sel).join(' | ')}`,
    );
  });
});
