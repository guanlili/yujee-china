import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const chat = readFileSync(join(here, 'ChatPanel.tsx'), 'utf8');

// 防退化:#305 后加图路径丢过一次写文案(judge 时代的 write_copy 没接回来)。
// 锁死接线:追加排版收尾必须派发追加范围成稿并轮询其完成。这三条是地基(函数/调用点在
// 全文件任意处存在过);真正锁住接线形态的是下面两条——切到具体分支/函数体里再匹配,
// 挪进注释、删掉包裹或搬去别处都会让切片变短/消失从而变红。
test('append 收尾接了追加范围成稿', () => {
  assert.ok(chat.includes('triggerAppendCompose('), 'append 收尾要调 triggerAppendCompose');
  assert.ok(chat.includes('composeAppendV3('), 'triggerAppendCompose 要 POST compose-append');
  assert.ok(chat.includes('waitForAppendComposeThenRefresh('), '派发后要轮询成稿完成');
});

test('waitForLayoutThenRefresh 的 append 分支里,已设计的书就地派发追加成稿', () => {
  // 就近上下文:先切出 if (opts?.append) { … } 这一段(在遇到同缩进的 `} else {` 时收口,
  // 与「未设计,保持既有收尾」的 else 分支划清),再在这段里断言调用——挪进注释或整段
  // 搬走都会让这个切片消失或不再含 triggerAppendCompose。
  const appendBranch = chat.match(/if \(opts\?\.append\) \{[\s\S]*?\n            \} else \{/)?.[0] ?? '';
  assert.ok(appendBranch, 'waitForLayoutThenRefresh 里应能切出 if (opts?.append) 分支');
  assert.match(
    appendBranch,
    /await triggerAppendCompose\(\{/,
    'append 分支里(已设计的书)必须 await triggerAppendCompose',
  );
});

test('triggerAppendCompose 函数体内直接 POST 追加范围成稿,派发后包 withWorkflowBusy 轮询', () => {
  const fn = chat.match(/async function triggerAppendCompose[\s\S]*?\n    \}/)?.[0] ?? '';
  assert.ok(fn, 'triggerAppendCompose should exist');
  assert.match(fn, /await composeAppendV3\(albumId,/, 'triggerAppendCompose 函数体内必须直接调 composeAppendV3');
  // 锁包裹形态:漏包 withWorkflowBusy 会让轮询期间发送键解禁(参照 send-btn-disabled.test.ts
  // 的「小水母在跑」惯例),必须是这个精确写法,不是裸调用 waitForAppendComposeThenRefresh。
  assert.match(
    fn,
    /void withWorkflowBusy\(\(\) => waitForAppendComposeThenRefresh\(host\)\);/,
    '派发成功后必须用 withWorkflowBusy 包住 waitForAppendComposeThenRefresh 轮询',
  );
});
