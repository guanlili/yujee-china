import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// 防退化:#305 后加图路径丢过一次写文案(judge 时代的 write_copy 没接回来)。
// 锁死接线:追加排版收尾必须派发追加范围成稿并轮询其完成。
test('append 收尾接了追加范围成稿', () => {
  const src = readFileSync(join(here, 'ChatPanel.tsx'), 'utf8');
  assert.ok(src.includes('triggerAppendCompose('), 'append 收尾要调 triggerAppendCompose');
  assert.ok(src.includes('composeAppendV3('), 'triggerAppendCompose 要 POST compose-append');
  assert.ok(src.includes('waitForAppendComposeThenRefresh('), '派发后要轮询成稿完成');
});
