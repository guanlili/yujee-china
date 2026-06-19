import assert from 'node:assert/strict';
import test from 'node:test';

import { TemplateTextRole } from './templates';
import {
  THEME_ACCENT_CARRIER_SUFFIX,
  THEME_FONT_CARRIER_SUFFIX,
  THEME_USER_PROSE_ROLES,
} from './theme-carrier';

// §3 树边界 carrier 文法是 packages/contracts 单一真相源(TS 端值锁;Python 端
// apps/agent/tests/test_schemas.py::TestThemeCarrierParity 断言逐字一致)。

test('carrier suffixes are the locked literals', () => {
  assert.equal(THEME_ACCENT_CARRIER_SUFFIX, '#accentColor');
  assert.equal(THEME_FONT_CARRIER_SUFFIX, '#artFont');
});

test('carrier suffixes start with # so they never collide with a real slotId', () => {
  // Real slot ids are plain ids or bracket-paths (`cells[0].image`) — none start
  // with `#`. The `#`-prefixed suffix guarantees zero collision (约定 ③).
  assert.ok(THEME_ACCENT_CARRIER_SUFFIX.startsWith('#'));
  assert.ok(THEME_FONT_CARRIER_SUFFIX.startsWith('#'));
});

test('prose-role set is the role enum minus `decoration` (derived, not hand-written)', () => {
  const allRoles = new Set(TemplateTextRole.options);
  const expected = new Set([...allRoles].filter((r) => r !== 'decoration'));
  assert.deepEqual(new Set(THEME_USER_PROSE_ROLES), expected);
  assert.deepEqual(new Set(THEME_USER_PROSE_ROLES), new Set(['title', 'body', 'explain']));
});
