import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// #165: WebImage/PdfImage now honor an optional per-slot position override.
// Absent ⇒ the historical default (objectPosition '50% 50%', objectFit cover);
// present ⇒ objectPosition `${x}% ${y}%`. Web additionally applies transform
// scale when scale>1; PDF keeps cover only (scale is web-only for now).

test('web image: conditional objectPosition, default 50% 50%, cover preserved', () => {
  const webSource = readFileSync(new URL('./web-utils.tsx', import.meta.url), 'utf8');
  // default branch when no override
  assert.match(
    webSource,
    /const objectPosition = position \? `\$\{position\.x\}% \$\{position\.y\}%` : '50% 50%';/,
  );
  // cover is always enforced after the caller style; objectPosition is the computed value
  assert.match(
    webSource,
    /\.\.\.style,\s*objectFit: 'cover',\s*objectPosition,\s*\.\.\.zoom,/s,
  );
  // scale>1 applies a transform zoom anchored at the focal point (web-only)
  assert.match(webSource, /position\.scale > 1/);
  assert.match(webSource, /transform: `scale\(\$\{position\.scale\}\)`/);
  assert.match(webSource, /transformOrigin: `\$\{position\.x\}% \$\{position\.y\}%`/);
});

test('pdf image: conditional objectPosition, default 50% 50%, cover only (scale web-only)', () => {
  const pdfSource = readFileSync(new URL('./pdf-utils.tsx', import.meta.url), 'utf8');
  assert.match(
    pdfSource,
    /const objectPosition = position \? `\$\{position\.x\}% \$\{position\.y\}%` : '50% 50%';/,
  );
  assert.match(
    pdfSource,
    /<Image\s+src=\{src\}\s+style=\{\{\s*\.\.\.style,\s*objectFit: 'cover',\s*objectPosition,\s*\}\}\s*\/>/s,
  );
  // PDF must NOT apply a transform/scale zoom (no @react-pdf transform support).
  assert.doesNotMatch(pdfSource, /transform: `scale/);
  assert.match(pdfSource, /TODO\(#165\): PDF zoom \(scale\) not yet supported/);
});
