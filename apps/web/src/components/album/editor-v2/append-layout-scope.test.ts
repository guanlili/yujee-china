import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const chat = readFileSync(join(here, 'ChatPanel.tsx'), 'utf8');

// 防御性:加图排版时「要排哪些章(chapterIds)」和「给哪些照片建 200px ref(refs)」必须同源、
// 必然对齐 —— 否则排的章里有张照片没带 ref → 服务端 missing 200px ref → 400(实测过的 bug)。
test('append select-layout: refs 与 chapterIds 同源,并补排滞留章', () => {
  const fn = chat.match(/async function triggerAppendSelectLayout[\s\S]*?\n    \}/)?.[0] ?? '';
  assert.ok(fn, 'triggerAppendSelectLayout should exist');

  // refs 从「要排的这些章实际用到的 photoId」推(chapterMetaById),不再只用当批 scope.photoIds。
  assert.match(fn, /chapterMetaById\(cid\)\?\.photoIds/, 'refs 必须从要排章节的真实 photoId 推');
  assert.doesNotMatch(
    fn,
    /const refs = await selectLayoutRefsFromStore\(scope\.photoIds\);/,
    '不得再只用当批 scope.photoIds 建 refs(会和 chapterIds 错位)',
  );
  assert.match(fn, /selectLayoutRefsFromStore\(refsPhotoIds\)/, 'refs 从对齐后的 refsPhotoIds 建');

  // 排版范围 = fresh ∪ 未排版的滞留章(doneChapterIds 之外),自愈级联卡住的章。
  assert.match(fn, /!\(storyGate\?\.doneChapterIds \?\? \[\]\)\.includes\(cid\)/, '把未排版的滞留章纳入补排');
  assert.match(fn, /chapterIds: layoutChapterIds,/, '提交的 chapterIds = 对齐后的 layoutChapterIds');
});
