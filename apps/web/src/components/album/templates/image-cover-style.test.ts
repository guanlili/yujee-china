import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('image helpers enforce centered cover after caller style', () => {
  const webSource = readFileSync(new URL('./web-utils.tsx', import.meta.url), 'utf8');
  const pdfSource = readFileSync(new URL('./pdf-utils.tsx', import.meta.url), 'utf8');

  assert.match(
    webSource,
    /style=\{\{\s*display: 'block',\s*\.\.\.style,\s*objectFit: 'cover',\s*objectPosition: '50% 50%',\s*\}\}/s,
  );
  assert.match(
    pdfSource,
    /<Image\s+src=\{src\}\s+style=\{\{\s*\.\.\.style,\s*objectFit: 'cover',\s*objectPosition: '50% 50%',\s*\}\}\s+\/>/s,
  );
});
