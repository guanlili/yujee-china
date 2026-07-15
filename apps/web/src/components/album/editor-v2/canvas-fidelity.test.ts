import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// 画板保真回归(2026-07-15):总览网格(#ovGrid)就是主画板 —— 无限画布,可缩放到
// 3x,所有编辑工具直接在上面用(EditorPort「画板 = 无限画布」注释)。它的渲染
// 必须和书籍视图完全一致:display 派生图 + fitTextBoxes + data-editable 标记。
// thumb 降级模式(240px 图、跳 fit-text、跳编辑标记)只允许用在底部 52px 缩略
// 图条上。此前把画板格误降级成 thumb → 画板和书籍预览内容不一致 + 编辑绑定丢失。

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'EditorPort.tsx'), 'utf8');

function fnBody(name: string): string {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at > -1, `${name} must exist`);
  // 到下一个同缩进 function 声明为止,够覆盖函数体。
  const next = src.indexOf('\n    function ', at + 1);
  return src.slice(at, next === -1 ? at + 4000 : next);
}

test('画板(总览网格)按书籍视图同款全保真模式 paint,绝不 thumb 降级', () => {
  const overview = fnBody('renderOverview');
  assert.match(overview, /paintEl\(/, 'renderOverview paints via paintEl');
  assert.doesNotMatch(
    overview,
    /thumb:\s*true/,
    '画板格不得用 thumb 模式(240px 图/跳 fit-text/跳 data-editable 会让画板和书籍预览不一致)',
  );
});

test('repaintPages 的画板格更新同样全保真', () => {
  const repaint = fnBody('repaintPages');
  assert.doesNotMatch(repaint, /oface[\s\S]{0,200}thumb:\s*true/, '脏页重绘的画板格不得 thumb 降级');
});

test('底部缩略图条保留 thumb 降级(那才是真缩略图)', () => {
  const thumbs = fnBody('paintThumbCell');
  assert.match(thumbs, /thumb:\s*true/);
});
