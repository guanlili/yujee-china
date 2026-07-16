import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 送出键禁用统一化(2026-07-16):AI 思考中(sending)与积分不足(outOfCredits)必须走
// 同一个真相源 —— 都经 refreshSendDisabled 落到原生 disabled 属性上,于是一条 CSS :disabled
// 同时覆盖两种禁用(灰底、无投影)。仓库测试跑在 tsx --test(无 jsdom),沿用同目录既有的
// 源码断言风格(见 canvas-centering.test.ts)。

const here = dirname(fileURLToPath(import.meta.url));
const chat = readFileSync(join(here, 'ChatPanel.tsx'), 'utf8');
const css = readFileSync(join(here, 'editor-port.css'), 'utf8');

test('送出键 disabled 是单一真相源:refreshSendDisabled = sending || outOfCredits', () => {
  // 两个标志都在闭包里。
  assert.match(chat, /let outOfCredits = false;/, 'outOfCredits 标志必须存在');
  // disabled 只从这一处派生,且正是 `sending || outOfCredits` —— 缺积分到账后若仍在忙 => 仍禁用;
  // 思考结束后若仍缺积分 => 仍禁用。这正是统一后要的行为。
  assert.match(
    chat,
    /function refreshSendDisabled\(\)\s*\{\s*if \(sendBtnEl\) sendBtnEl\.disabled = sending \|\| outOfCredits;/,
    'refreshSendDisabled 必须把 disabled 设为 sending || outOfCredits',
  );
  // setSending 是 sending 的唯一写入口,写完立刻刷新 disabled。
  assert.match(
    chat,
    /function setSending\(v: boolean\)\s*\{\s*sending = v;\s*refreshSendDisabled\(\);/,
    'setSending 必须写 sending 后刷新 disabled',
  );
});

test('AI 忙全程经 setSending;除声明与 setter 外无裸 sending 赋值', () => {
  // 裸 `sending = true` 应为 0(全部改为 setSending(true))。
  assert.equal(
    (chat.match(/\bsending = true/g) ?? []).length,
    0,
    '不得存在裸 sending = true(应全部改为 setSending(true))',
  );
  // 含 `sending = false` 的行必须只剩声明行 `let sending = false;`(setter 写的是 `sending = v`)。
  const falseLines = chat
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /\bsending = false/.test(l));
  assert.deepEqual(
    falseLines,
    ['let sending = false;'],
    '除 `let sending = false` 声明外不得有裸 sending = false 赋值',
  );
  // 12 个赋值点全部改成了 setSending(4 true + 8 false)。
  assert.equal((chat.match(/setSending\(true\)/g) ?? []).length, 4, '应有 4 处 setSending(true)');
  assert.equal((chat.match(/setSending\(false\)/g) ?? []).length, 8, '应有 8 处 setSending(false)');
});

test('缺积分不再直接摸 send.disabled;统一走 outOfCredits + refreshSendDisabled', () => {
  // 全文件不得再出现任何 send.disabled 直接赋值(showPurchaseCard / 到账 / 关闭按钮都改了)。
  assert.doesNotMatch(chat, /send\.disabled\s*=/, '不得再直接赋值 send.disabled');
  // showPurchaseCard 用 outOfCredits=true 触发禁用。
  assert.match(
    chat,
    /outOfCredits = true;\s*\n\s*refreshSendDisabled\(\);/,
    'showPurchaseCard 必须设 outOfCredits=true 并刷新',
  );
  // #balanceAlert 关闭按钮走 data-action(和 buyShells 同一约定),不再 JSX 内联摸 DOM。
  assert.match(
    chat,
    /data-action="dismissBalanceAlert"/,
    '关闭按钮必须走 data-action="dismissBalanceAlert"',
  );
  assert.match(
    chat,
    /dismissBalanceAlert:\s*\(\)\s*=>\s*\{[\s\S]*?outOfCredits = false;[\s\S]*?refreshSendDisabled\(\);/,
    'dismissBalanceAlert 处理器必须清 outOfCredits 并刷新',
  );
});

test('送出键无内联投影;禁用态灰底 + 无投影落在 CSS 里', () => {
  // JSX 送出键不再带内联 boxShadow,也不用半透明 opacity-40(改用灰 token)。
  const sendBtnJsx = /<button className="send-btn[\s\S]*?id="sendBtn"[\s\S]*?>/.exec(chat);
  assert.ok(sendBtnJsx, 'sendBtn 按钮必须存在');
  assert.doesNotMatch(sendBtnJsx![0], /boxShadow/, '送出键不得再有内联 boxShadow');
  assert.doesNotMatch(sendBtnJsx![0], /disabled:opacity-40/, '禁用态改用灰底,不用半透明 opacity-40');
  // CSS:正常态投影搬到 .send-btn;禁用态灰底 + 去投影,灰值走 --border/--muted token。
  assert.match(
    css,
    /\.editor-port \.send-btn\{[^}]*box-shadow:0 1px 3px/,
    '.send-btn 正常态投影必须搬进 CSS',
  );
  const disabledRule = /\.editor-port \.send-btn:disabled\{([^}]*)\}/.exec(css);
  assert.ok(disabledRule, '.send-btn:disabled 规则必须存在');
  assert.match(disabledRule![1], /background:var\(--border\)/, '禁用态灰底用 --border token');
  assert.match(disabledRule![1], /color:var\(--muted\)/, '禁用态图标用 --muted token');
  assert.match(disabledRule![1], /box-shadow:none/, '禁用态必须去投影');
});
