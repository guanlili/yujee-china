import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'RetryFailedButton.tsx'), 'utf8');

test('RetryFailedButton localizes retry copy from the current route locale', () => {
  assert.match(source, /const locale = detectLocale\(pathname\)/, 'retry button should derive locale from the current route');
  assert.match(source, /tryAgain: '重试一次'/, 'Chinese retry copy should not show English in zh pages');
  assert.match(source, /retrying: '重试中…'/, 'Chinese busy copy should be localized');
  assert.match(source, /tryAgain: 'Try again'/, 'English retry copy should remain available');
  assert.match(source, /busy \? copy\.retrying : copy\.tryAgain/, 'button label should use localized copy');
});
