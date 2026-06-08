import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const components = join(here, '..');

function source(path: string): string {
  return readFileSync(join(components, path), 'utf8');
}

test('marketing nav delegates the right status cluster to ChromeStatusBar', () => {
  const statusBar = source('app/ChromeStatusBar.tsx');
  const marketingNav = source('marketing/MarketingNav.tsx');

  assert.match(statusBar, /showPricing\??: boolean/, 'ChromeStatusBar owns pricing visibility');
  assert.match(statusBar, /href="#pricing"/, 'ChromeStatusBar owns the public pricing link (same-page #pricing anchor)');
  assert.match(
    marketingNav,
    /<ChromeStatusBar locale=\{locale\} languageClassName="hidden sm:block" session=\{session\} \/>/,
    'MarketingNav should reuse the chrome status cluster for language/login/user controls',
  );
  assert.doesNotMatch(marketingNav, /showPricing/, 'MarketingNav should not duplicate pricing in the right status cluster');
  assert.match(marketingNav, /m\.nav\.pricing/, 'MarketingNav owns the Home 1 centered pricing link');
  assert.match(marketingNav, /homeSectionHref\('pricing'\)/, 'MarketingNav pricing should target the landing pricing section');
});

test('pricing uses the same chrome pill style source as the language switcher', () => {
  const statusBar = source('app/ChromeStatusBar.tsx');
  const languageSwitcher = source('app/LanguageSwitcher.tsx');

  assert.match(statusBar, /CHROME_PILL_BUTTON_CLASS/, 'Pricing should use the shared chrome pill class');
  assert.match(languageSwitcher, /CHROME_PILL_BUTTON_CLASS/, 'LanguageSwitcher should use the shared chrome pill class');
  assert.doesNotMatch(
    statusBar,
    /className="hidden items-center rounded-full bg-\[#ececec\] px-3 py-1\.5 text-sm/,
    'Pricing must not keep a separate, smaller pill class',
  );
});

test('marketing chrome keeps a single black login action instead of a separate get-started button', () => {
  const statusBar = source('app/ChromeStatusBar.tsx');
  const marketingNav = source('marketing/MarketingNav.tsx');

  assert.match(statusBar, /LOGIN_BUTTON_CLASS/, 'ChromeStatusBar should own the login button class');
  assert.match(statusBar, /bg-\[var\(--fg\)\]/, 'Login action should stay the black primary pill');
  assert.match(statusBar, /text-white/, 'Login action should keep readable white text');
  assert.doesNotMatch(marketingNav, /getStarted|Get started/, 'MarketingNav must not render a second get-started action');
});
