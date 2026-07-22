import assert from 'node:assert/strict';
import test from 'node:test';

import { TEMPLATE_IDS, TEMPLATES } from '@yujee/contracts/templates';
import { applyFolioOverlay, pageFolioInfos } from './page-html-dom';

const COVER = TEMPLATE_IDS.find((id) => TEMPLATES[id]?.category === 'cover')!;
const SPREAD = TEMPLATE_IDS.find((id) => TEMPLATES[id]?.spread === true);

test('cover carries no folio; interior numbers from 1 and sides follow the spread', () => {
  assert.deepEqual(pageFolioInfos([COVER, 'mag-03', 'mag-05']), [
    { folio: null, side: 'right' },
    { folio: 1, side: 'left' },
    { folio: 2, side: 'right' },
  ]);
});

test('a spread page eats two folio numbers and prints both sides', (t) => {
  if (!SPREAD) return t.skip('还没有 spread 模板(Task 8 会加 mag-54)');
  assert.deepEqual(pageFolioInfos([COVER, SPREAD, 'mag-03']), [
    { folio: null, side: 'right' },
    { folio: { left: 1, right: 2 }, side: 'left' },
    { folio: 3, side: 'left' },
  ]);
});

test('a dual folio injects two page numbers', () => {
  const html = '<div data-template="x"></div>';
  const out = applyFolioOverlay(html, { left: 4, right: 5 });
  assert.equal((out.match(/data-page-folio="true"/g) ?? []).length, 2);
  assert.ok(out.includes('>4</div>'));
  assert.ok(out.includes('>5</div>'));
});
