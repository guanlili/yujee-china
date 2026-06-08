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

test('pricing uses the shared chrome pill style', () => {
  const statusBar = source('app/ChromeStatusBar.tsx');

  assert.match(statusBar, /CHROME_PILL_BUTTON_CLASS/, 'Pricing should use the shared chrome pill class');
  assert.doesNotMatch(
    statusBar,
    /className="hidden items-center rounded-full bg-\[#ececec\] px-3 py-1\.5 text-sm/,
    'Pricing must not keep a separate, smaller pill class',
  );
});

test('language switcher matches the Home 1 nav pill (ghost pill + dropdown with tick)', () => {
  const languageSwitcher = source('app/LanguageSwitcher.tsx');

  // Home 1 trigger is a ghost pill, not the shared solid chrome pill.
  assert.doesNotMatch(
    languageSwitcher,
    /CHROME_PILL_BUTTON_CLASS/,
    'LanguageSwitcher should not reuse the shared solid chrome pill',
  );
  assert.match(languageSwitcher, /bg-black\/\[0\.06\]/, 'Trigger should use the Home 1 ghost pill background');
  // Current locale is marked with a right-aligned tick, not a full black row.
  assert.match(languageSwitcher, /✓/, 'Active locale should be marked with a tick');
  assert.doesNotMatch(languageSwitcher, /bg-\[var\(--fg\)\]/, 'Active locale must not be a full black row');
});

test('top chrome no longer renders a credits pill', () => {
  const sessionControls = source('app/SessionControls.tsx');
  const chromeStatusBar = source('app/ChromeStatusBar.tsx');
  const appChrome = source('app/AppChrome.tsx');

  assert.doesNotMatch(sessionControls, /CreditsPill/, 'SessionControls must not render the credits pill');
  assert.doesNotMatch(sessionControls, /showCredits/, 'SessionControls must drop the showCredits prop');
  assert.doesNotMatch(chromeStatusBar, /showCredits/, 'ChromeStatusBar must drop the showCredits prop');
  assert.doesNotMatch(appChrome, /showCredits/, 'AppChrome must drop the showCredits prop');
});

test('marketing chrome keeps a single black login action instead of a separate get-started button', () => {
  const statusBar = source('app/ChromeStatusBar.tsx');
  const marketingNav = source('marketing/MarketingNav.tsx');

  assert.match(statusBar, /LOGIN_BUTTON_CLASS/, 'ChromeStatusBar should own the login button class');
  assert.match(statusBar, /bg-\[var\(--fg\)\]/, 'Login action should stay the black primary pill');
  assert.match(statusBar, /text-white/, 'Login action should keep readable white text');
  assert.doesNotMatch(marketingNav, /getStarted|Get started/, 'MarketingNav must not render a second get-started action');
});
