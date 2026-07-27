import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { resolveBackTarget } from './back-nav';

const HERE = dirname(fileURLToPath(import.meta.url));

test('resolveBackTarget:同源来处 → 回上一页', () => {
  const origin = 'https://yujee.app';
  assert.equal(resolveBackTarget('https://yujee.app/zh/my-albums', origin), 'history');
  assert.equal(resolveBackTarget('https://yujee.app/zh/album/abc', origin), 'history');
  assert.equal(resolveBackTarget('https://yujee.app/s/tok?x=1#y', origin), 'history');
});

test('resolveBackTarget:没有来处(直接粘 URL / 新标签页) → 回相册列表', () => {
  assert.equal(resolveBackTarget('', 'https://yujee.app'), 'albums');
});

test('resolveBackTarget:站外来处 → 回相册列表(back() 会把人踢出站)', () => {
  const origin = 'https://yujee.app';
  assert.equal(resolveBackTarget('https://www.google.com/search?q=yujee', origin), 'albums');
  assert.equal(resolveBackTarget('https://yujee.app.evil.com/', origin), 'albums');
  // 同域名不同 scheme/端口也算跨源
  assert.equal(resolveBackTarget('http://yujee.app/zh', origin), 'albums');
  assert.equal(resolveBackTarget('https://yujee.app:8443/zh', origin), 'albums');
});

test('resolveBackTarget:referrer 不是合法 URL 时不抛,落到相册列表', () => {
  assert.doesNotThrow(() => resolveBackTarget('not a url', 'https://yujee.app'));
  assert.equal(resolveBackTarget('not a url', 'https://yujee.app'), 'albums');
  assert.equal(resolveBackTarget('https://yujee.app/x', ''), 'albums');
});

test('MobileEditorRoot:浏览态返回键必须接来处,不许无条件硬跳 my-albums(回归)', () => {
  // 此前 EditorPort 挂载时不传 onBack,兜底一律 push('/{locale}/my-albums'),
  // 从相册预览点进来的人返回时被拽去列表页而不是回上一页。
  const src = readFileSync(join(HERE, 'MobileEditorRoot.tsx'), 'utf8');
  assert.match(src, /resolveBackTarget/, '返回键必须过 resolveBackTarget 判来处');
  assert.doesNotMatch(
    src,
    /onBack=\{onBack \?\? \(\(\) => router\.push\(`\/\$\{locale\}\/my-albums`\)\)\}/,
    '不许保留「无条件硬跳 my-albums」的旧兜底',
  );
});
