import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultLocale } from './routing';
import { resolveLocale } from './server-locale';

test('resolveLocale passes through a supported locale', () => {
  assert.equal(resolveLocale('zh'), 'zh');
  assert.equal(resolveLocale('en'), 'en');
});

test('resolveLocale falls back rather than trusting an arbitrary header value', () => {
  // The header is attacker-controllable in principle; it must never reach
  // <html lang> unvalidated.
  assert.equal(resolveLocale('fr'), defaultLocale);
  assert.equal(resolveLocale('"><script>'), defaultLocale);
  assert.equal(resolveLocale(''), defaultLocale);
  assert.equal(resolveLocale(null), defaultLocale);
  assert.equal(resolveLocale(undefined), defaultLocale);
});
