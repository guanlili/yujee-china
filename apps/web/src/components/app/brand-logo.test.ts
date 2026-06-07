import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const components = join(here, '..');
const webRoot = join(components, '..', '..');

function source(path: string): string {
  return readFileSync(join(components, path), 'utf8');
}

test('brand mark uses the final yujee wordmark logo asset', () => {
  const logoPath = join(webRoot, 'public', 'brand', 'yujee-logo.svg');
  const appIconPath = join(webRoot, 'src', 'app', 'icon.png');
  const appleIconPath = join(webRoot, 'src', 'app', 'apple-icon.png');

  assert.equal(existsSync(logoPath), true, 'optimized public logo asset should exist');

  // Guard the asset's content, not just its presence: the v1 wordmark must keep
  // the teal brand color and its wide aspect, so a stray re-export (or a revert
  // to the old purple mark) fails loudly instead of passing on file existence.
  const logoSvg = readFileSync(logoPath, 'utf8');
  assert.match(logoSvg, /#13B8A6/i, 'logo should keep the teal brand color');
  assert.match(logoSvg, /viewBox="0 0 2824 1180"/, 'logo should keep the wordmark viewBox');
  assert.equal(existsSync(appIconPath), true, 'app icon should use the final logo');
  assert.equal(existsSync(appleIconPath), true, 'apple touch icon should use the final logo');
  assert.ok(statSync(logoPath).size < 250_000, 'public logo should be optimized for repeated chrome use');

  const brand = source('app/Brand.tsx');
  assert.match(brand, /BRAND_LOGO_SRC/, 'Brand should render from the shared logo source');
  assert.doesNotMatch(brand, /bg-gradient-to-br|grad-green|grad-purple|grad-lime/, 'Brand must not use the old gradient mark');
});

test('brand surfaces reuse Brand or BrandMark instead of hardcoded gradient logo blocks', () => {
  const files = [
    source('marketing/MarketingNav.tsx'),
    source('marketing/MarketingChrome.tsx'),
    readFileSync(join(webRoot, 'src', 'app', '[locale]', 'login', 'page.tsx'), 'utf8'),
    readFileSync(join(webRoot, 'src', 'app', '[locale]', 'register', 'page.tsx'), 'utf8'),
    readFileSync(join(webRoot, 'src', 'app', '[locale]', 'register', 'register-form.tsx'), 'utf8'),
  ].join('\n');

  assert.match(files, /BrandMark|<Brand /, 'brand surfaces should use the shared brand components');
  assert.doesNotMatch(
    files,
    /bg-gradient-to-br from-\[var\(--grad-green\)\]|bg-\[linear-gradient\(135deg,var\(--grad-green\)/,
    'brand surfaces must not keep the old gradient logo block',
  );
});
