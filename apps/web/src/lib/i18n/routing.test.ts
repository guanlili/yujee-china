import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  defaultLocale,
  detectLocale,
  isLocale,
  locales,
  localizePath,
  stripLocale,
} from './routing';

describe('i18n routing', () => {
  it('defines the supported locale contract', () => {
    assert.deepEqual(locales, ['en', 'zh']);
    assert.equal(defaultLocale, 'en');
    assert.equal(isLocale('en'), true);
    assert.equal(isLocale('fr'), false);
  });

  it('normalizes locale prefixes without duplicating them', () => {
    assert.equal(localizePath('/login', 'zh'), '/zh/login');
    assert.equal(localizePath('/en/register', 'en'), '/en/register');
    assert.equal(stripLocale('/zh/create'), '/create');
    assert.equal(stripLocale('/en'), '/');
  });

  it('detects the locale from a pathname and falls back to English', () => {
    assert.equal(detectLocale('/zh/register'), 'zh');
    assert.equal(detectLocale('/login'), 'en');
  });
});
