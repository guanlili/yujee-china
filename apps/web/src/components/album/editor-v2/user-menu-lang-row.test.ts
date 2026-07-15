import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 头像菜单语言行累积回归:EN/中文 行由画布 effect 命令式注入(header.after(row)),
// 而画布 EditorBook 按 pages.length/canvasEpoch 重挂,topbar 在稳定壳里不重挂 ——
// 注入若不幂等,画布每重挂一次菜单就多一排 EN/中文(线上实测两排)。

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'EditorPort.tsx'), 'utf8');

test('用户菜单语言行注入必须幂等:带 data-lang-row 标记,注入前清掉旧行', () => {
  const at = src.indexOf('Language switch (decision: in the user menu)');
  assert.ok(at > -1, 'lang-row injection block must exist');
  const block = src.slice(at, at + 1200);
  assert.match(block, /data-lang-row/, '注入的行必须带 data-lang-row 标记');
  assert.match(
    block,
    /querySelectorAll\(\s*'\[data-lang-row\]'\s*\)[\s\S]{0,80}remove\(\)/,
    '注入前必须清除已存在的语言行(画布重挂不累积)',
  );
});
