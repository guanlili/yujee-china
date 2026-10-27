import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LOCALE_LABELS,
  defaultLocale,
  detectLocale,
  isLocale,
  locales,
  localizePath,
  stripLocale,
} from './routing';

describe('i18n routing', () => {
  it('defines the supported locale contract', () => {
    assert.deepEqual(locales, ['en', 'zh', 'es', 'ja', 'fr']);
    // 国内版默认中文：无前缀/无 cookie 的首访落到 /zh，英文经切换器仍可用。
    assert.equal(defaultLocale, 'zh');
    assert.equal(isLocale('en'), true);
    assert.equal(isLocale('ja'), true);
    // A plausible-looking language tag we do NOT ship must still be rejected.
    assert.equal(isLocale('de'), false);
  });

  it('gives every locale a native-name label', () => {
    for (const locale of locales) {
      assert.equal(typeof LOCALE_LABELS[locale], 'string');
      assert.ok(LOCALE_LABELS[locale].length > 0, `${locale} needs a label`);
    }
    assert.equal(new Set(Object.values(LOCALE_LABELS)).size, locales.length);
  });

  it('normalizes locale prefixes without duplicating them', () => {
    assert.equal(localizePath('/login', 'zh'), '/zh/login');
    assert.equal(localizePath('/en/register', 'en'), '/en/register');
    assert.equal(localizePath('/login', 'ja'), '/ja/login');
    assert.equal(stripLocale('/zh/create'), '/create');
    assert.equal(stripLocale('/fr/create'), '/create');
    assert.equal(stripLocale('/en'), '/');
  });

  it('detects the locale from a pathname and falls back to the default locale', () => {
    assert.equal(detectLocale('/zh/register'), 'zh');
    assert.equal(detectLocale('/es/register'), 'es');
    assert.equal(detectLocale('/login'), 'zh');
  });
});
