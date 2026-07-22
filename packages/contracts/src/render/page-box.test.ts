import assert from 'node:assert/strict';
import test from 'node:test';

import { PAGE } from './constants';
import { isSpreadTemplate, pageBox } from './page-box';

test('normal template keeps the A4 page box', () => {
  assert.deepEqual(pageBox('mag-03'), { width: PAGE.width, height: PAGE.height });
  assert.equal(isSpreadTemplate('mag-03'), false);
});

test('unknown template falls back to the A4 page box', () => {
  assert.deepEqual(pageBox('does-not-exist'), { width: PAGE.width, height: PAGE.height });
  assert.equal(isSpreadTemplate('does-not-exist'), false);
});

test('a spread template doubles the page box width (mag-54, #303 first spread template)', () => {
  assert.deepEqual(pageBox('mag-54'), { width: PAGE.width * 2, height: PAGE.height });
  assert.equal(isSpreadTemplate('mag-54'), true);
});
