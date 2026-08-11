import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultLocale, locales } from './routing';
import { resolveLocale } from './server-locale';

test('resolveLocale passes through a supported locale', () => {
  for (const locale of locales) assert.equal(resolveLocale(locale), locale);
});

test('resolveLocale falls back rather than trusting an arbitrary header value', () => {
  // The header is attacker-controllable in principle; it must never reach
  // <html lang> unvalidated.
  assert.equal(resolveLocale('de'), defaultLocale);
  assert.equal(resolveLocale('"><script>'), defaultLocale);
  assert.equal(resolveLocale(''), defaultLocale);
  assert.equal(resolveLocale(null), defaultLocale);
  assert.equal(resolveLocale(undefined), defaultLocale);
});
