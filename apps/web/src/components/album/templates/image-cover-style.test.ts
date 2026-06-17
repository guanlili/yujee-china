import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// #165: WebImage/PdfImage honor an optional per-slot position override.
//   Absent ⇒ objectPosition '50% 50%' (centered cover); present ⇒ `${x}% ${y}%`.
// #168: the slot `style` is now the geometry of a FIXED frame — an
// `overflow:hidden` wrapper (web <div> / pdf <View>) — and the image fills that
// frame 100%×100%. A scale>1 zoom is applied to the INNER image and clipped by the
// wrapper, so it can never grow the slot box / push neighboring content. PDF now
// implements the same zoom (no @react-pdf transform → emulated via an oversized,
// offset inner View) so preview and export match.

test('#168 web image: overflow-hidden wrapper, inner img fills 100% with cover', () => {
  const webSource = readFileSync(new URL('./web-utils.tsx', import.meta.url), 'utf8');
  // default branch when no override
  assert.match(
    webSource,
    /const objectPosition = position \? `\$\{position\.x\}% \$\{position\.y\}%` : '50% 50%';/,
  );
  // the caller style (slot geometry) is spread onto a wrapper that clips overflow,
  // after stripping the paint-only objectFit/objectPosition off it
  assert.match(webSource, /const \{ objectFit: _of, objectPosition: _op, \.\.\.frame \} = style;/);
  assert.match(webSource, /<div\s+style=\{\{\s*\.\.\.frame,\s*overflow: 'hidden',\s*\}\}\s*>/s);
  // inner <img> fills the frame and keeps cover + computed objectPosition + zoom
  assert.match(
    webSource,
    /width: '100%',\s*height: '100%',\s*objectFit: 'cover',\s*objectPosition,\s*\.\.\.zoom,/s,
  );
  // scale>1 applies the transform zoom (anchored at focal point) on the INNER img
  assert.match(webSource, /position\.scale > 1/);
  assert.match(webSource, /transform: `scale\(\$\{position\.scale\}\)`/);
  assert.match(webSource, /transformOrigin: `\$\{position\.x\}% \$\{position\.y\}%`/);
  // the editor still locates the slot via data-image-slot on the inner <img>
  assert.match(webSource, /<img[\s\S]*?data-image-slot=\{slotId\}/);
});

test('#168 pdf image: overflow-hidden wrapper, scale implemented to match web', () => {
  const pdfSource = readFileSync(new URL('./pdf-utils.tsx', import.meta.url), 'utf8');
  assert.match(
    pdfSource,
    /const objectPosition = position \? `\$\{position\.x\}% \$\{position\.y\}%` : '50% 50%';/,
  );
  // wrapper <View> clips overflow; geometry stripped of paint props like web
  assert.match(pdfSource, /const \{ objectFit: _of, objectPosition: _op, \.\.\.frame \} = style;/);
  assert.match(pdfSource, /<View style=\{\{ \.\.\.frame, overflow: 'hidden' \}\}>/);
  // inner Image fills 100%×100% with cover + objectPosition (both scale branches)
  assert.match(
    pdfSource,
    /width: '100%', height: '100%', objectFit: 'cover', objectPosition/,
  );
  // PDF now IMPLEMENTS zoom (the #165 TODO is gone): oversized, offset inner View
  assert.doesNotMatch(pdfSource, /TODO\(#165\): PDF zoom \(scale\) not yet supported/);
  assert.match(pdfSource, /width: `\$\{scale \* 100\}%`/);
  assert.match(pdfSource, /const offX = -\(\(scale - 1\) \* position!\.x\);/);
  assert.match(pdfSource, /const offY = -\(\(scale - 1\) \* position!\.y\);/);
});
