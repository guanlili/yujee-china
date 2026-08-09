import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'RetryFailedButton.tsx'), 'utf8');

test('RetryFailedButton localizes retry copy from the current route locale', () => {
  assert.match(source, /const locale = detectLocale\(pathname\)/, 'retry button should derive locale from the current route');
  // Copy pairs now go through pick(), which also serves the overlay languages.
  assert.match(source, /tryAgain: pick\(locale, \{ zh: '重试一次', en: 'Try again' \}\)/, 'retry copy should carry both source languages');
  assert.match(source, /retrying: pick\(locale, \{ zh: '重试中…', en: 'Retrying…' \}\)/, 'busy copy should carry both source languages');
  assert.match(source, /busy \? copy\.retrying : copy\.tryAgain/, 'button label should use localized copy');
});
