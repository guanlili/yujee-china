import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Regression guard for issue #155: the spread (non-FlipBook) preview clipped the
// right page / shifted the whole page down-right.
//
// Root cause: paintEl() (EditorPort.tsx) injects the full 794×1123 page scaled
// to fill el.clientWidth/clientHeight — the BORDER box. The .page / .leaf boxes
// carried `padding: 5.5%`, so the scaled content was sized to the border box but
// started from the content-box top-left → the page shifted right+down ~5.5% and
// overflowed; the right/bottom was cut by `overflow:hidden`. The 794×1123 page
// already carries its own print margins, so the page box must be flush (padding
// 0), matching FlipBook's PageFace which has no padding.
//
// No DOM harness exists here (tests run under `tsx --test` / node:test, no jsdom),
// so — following the repo's source-assertion style (see editor-layout.test.ts /
// balance-alert-on-mount.test.ts) — we assert the CSS box model directly.

const here = dirname(fileURLToPath(import.meta.url));

function source(file: string): string {
  return readFileSync(join(here, file), 'utf8');
}

// Pull the declaration body of a CSS rule by its exact selector.
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(m, `expected a CSS rule for "${selector}"`);
  return m![1];
}

test('.page (full-page spread box) carries no 5.5% padding that would shift/clip the scaled page', () => {
  const css = source('editor-port.css');
  const body = ruleBody(css, '.editor-port .page');

  // It still declares padding (explicitly flush), and that padding is 0 — never 5.5%.
  assert.match(body, /padding:\s*0\b/, '.page must explicitly zero its padding');
  assert.doesNotMatch(
    body,
    /padding:[^;]*5\.5%/,
    '.page must not reintroduce 5.5% padding (it offsets+clips the injected 794×1123 page)',
  );
});

test('.leaf (flip-animation page box) carries no 5.5% padding either', () => {
  const css = source('editor-port.css');
  const body = ruleBody(css, '.editor-port .leaf');

  assert.match(body, /padding:\s*0\b/, '.leaf must explicitly zero its padding');
  assert.doesNotMatch(
    body,
    /padding:[^;]*5\.5%/,
    '.leaf must not reintroduce 5.5% padding (it hosts the same full scaled page as .page)',
  );
});

test('paintEl sizes the injected page to the element box, so the box must be flush', () => {
  // Guards the assumption the CSS fix relies on: paintEl measures clientWidth/
  // clientHeight (the padding-inclusive box) and the page is scaled to fill it.
  // If this ever changes (e.g. reads the content box / uses absolute fill), the
  // padding constraint above can be revisited.
  const tsx = source('EditorPort.tsx');
  assert.match(
    tsx,
    /el\.clientWidth[\s\S]{0,40}el\.clientHeight/,
    'paintEl is expected to size the page to el.clientWidth/clientHeight',
  );
});
