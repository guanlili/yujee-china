import assert from 'node:assert/strict';
import test from 'node:test';

import { TEMPLATE_IDS, TEMPLATES } from '@yujee/contracts/templates';
import { placePages } from './page-layout';

const COVER = TEMPLATE_IDS.find((id) => TEMPLATES[id]?.category === 'cover')!;
const SPREAD = TEMPLATE_IDS.find((id) => TEMPLATES[id]?.spread === true);

test('interior pages pair in order after a solo cover', () => {
  assert.deepEqual(placePages([COVER, 'mag-03', 'mag-05', 'mag-06']), [
    { spreadIndex: 0, side: 'right' },
    { spreadIndex: 1, side: 'left' },
    { spreadIndex: 1, side: 'right' },
    { spreadIndex: 2, side: 'left' },
  ]);
});

test('a spread template owns a whole spread and never becomes a right half', (t) => {
  if (!SPREAD) return t.skip('还没有 spread 模板(Task 8 会加 mag-54)');
  // mag-03 单独占了一个左半页;spread 页不能被塞进它的右半,必须自己起一个 spread。
  assert.deepEqual(placePages([COVER, 'mag-03', SPREAD, 'mag-05']), [
    { spreadIndex: 0, side: 'right' },
    { spreadIndex: 1, side: 'left' },
    { spreadIndex: 2, side: 'both' },
    { spreadIndex: 3, side: 'left' },
  ]);
});
