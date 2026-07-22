import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Cover/ending single-page render on the MAIN canvas (EditorPort, not FlipBook).
//
// A cover spread is { left:null, right:i } and an ending spread is { left:i, right:null }.
// Before this change the empty facing half was made transparent (.page-empty) but still
// occupied flex:1 = half the double-width .book container, so the cover sat off-center with
// a blank half-page beside it. The fix narrows the container to single-page width
// (.book-single) and drops the empty half from layout — but ONLY for a TRUE cover/ending
// solo. The trap: an interior odd-trailing page is also { left:i, right:null } (identical
// shape to an ending) but its blank half is normal spread whitespace that must stay. So the
// discriminator is isSoloSpread (keyed off the occupied page's CATEGORY), never "a null half".
//
// No DOM harness exists here (tests run under `tsx --test` / node:test, no jsdom), so —
// following the repo's source-assertion style (see spread-page-padding.test.ts) — we assert
// the wiring in source + the CSS box model directly.

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

// ── Discrimination: solo collapse is driven by isSoloSpread, NOT by "a null half".

test('EditorPort imports isSoloSpread (the category-keyed discriminator) from spreads', () => {
  const tsx = source('EditorPort.tsx');
  assert.match(
    tsx,
    /import\s*\{[^}]*\bisSoloSpread\b[^}]*\}\s*from\s*'\.\.\/spreads'/,
    'EditorPort must import isSoloSpread to tell a true cover/ending solo from an interior odd-trailing page',
  );
});

test('paintSpread toggles .book-single off isSoloSpread, never off a raw null half', () => {
  const tsx = source('EditorPort.tsx');
  // The single-width collapse is keyed off isSoloSpread(spreads[i], …).
  assert.match(
    tsx,
    /classList\.toggle\(\s*'book-single'\s*,\s*isSoloSpread\(\s*spreads\[i\]\s*,\s*pagesState\s*\)\s*\)/,
    "paintSpread must toggle 'book-single' off isSoloSpread(spreads[i], pagesState)",
  );
  // Guard against regressing to a null-half key (which would wrongly collapse interior
  // odd-trailing pages). book-single must NOT be toggled off "lp === null || rp === null".
  assert.doesNotMatch(
    tsx,
    /classList\.toggle\(\s*'book-single'\s*,[^)]*===\s*null/,
    "'book-single' must not key off a null half (that would collapse interior odd-trailing pages)",
  );
});

test('book-solo / page-empty stay keyed off a null half (unchanged for interior odd-trailing)', () => {
  const tsx = source('EditorPort.tsx');
  // The pre-existing #158 behaviour (transparent blank half + dropped spine) is what an
  // interior odd-trailing page relies on, and it must remain keyed off a null half.
  // #303 added a `fullIdx == null &&` guard so a double-wide spread page (which is
  // painted as { left: page, right: null } but is NOT "one half empty" — it has no
  // gutter at all, hidden separately by book-full) doesn't also trip book-solo's
  // gutter-drop. The null-half discriminator itself (lp === null || rp === null) is
  // unchanged — book-solo still must not regress to isSoloSpread's category key.
  // The parens around `lp === null || rp === null` are load-bearing, not incidental: without
  // them `&&` binds tighter than `||`, so `fullIdx == null && lp === null || rp === null`
  // would parse as `(fullIdx == null && lp === null) || rp === null` — and since a full-spread
  // page always has rp === null, book-solo would then fire on EVERY full-spread page right
  // alongside book-full, the exact "two gutter-hiding mechanisms fighting" bug #303 warned
  // about. So the grouping parens must be required here, not optional.
  assert.match(
    tsx,
    /classList\.toggle\(\s*'book-solo'\s*,\s*fullIdx\s*==\s*null\s*&&\s*\(\s*lp === null \|\| rp === null\s*\)\s*\)/,
    'book-solo must stay keyed off a null half so interior odd-trailing pages keep their transparent blank half',
  );
  assert.doesNotMatch(
    tsx,
    /classList\.toggle\(\s*'book-solo'\s*,\s*isSoloSpread/,
    "'book-solo' must not key off isSoloSpread (that is book-single's discriminator, not book-solo's)",
  );
  assert.match(tsx, /classList\.toggle\('page-empty', lp === null\)/);
  assert.match(tsx, /classList\.toggle\('page-empty', rp === null\)/);
});

// ── Flip animation: solo endpoints switch directly (the container width changes, so
// the double-width leaf geometry can't animate across it without tearing).

test('flipTo switches directly when either endpoint is a cover/ending solo', () => {
  const tsx = source('EditorPort.tsx');
  const flip = /function flipTo\([^]*?\n    \}/.exec(tsx);
  assert.ok(flip, 'expected to locate the flipTo function body');
  const body = flip![0];

  // A guard that early-returns (direct paint, no leaf) when current OR target is solo.
  assert.match(
    body,
    /if \(isSoloSpread\(spreads\[currentCh\], pagesState\) \|\| isSoloSpread\(spreads\[nextIdx\], pagesState\)\)/,
    'flipTo must take a direct-switch branch when either the current or target spread is a cover/ending solo',
  );
  // That branch repaints the destination and clears the flipping latch (no leaf animation).
  const guard = /if \(isSoloSpread\([^]*?\n      \}/.exec(body);
  assert.ok(guard, 'expected the solo-flip guard block');
  assert.match(guard![0], /currentCh = nextIdx;/, 'solo flip must advance currentCh');
  assert.match(guard![0], /paintSpread\(nextIdx\);/, 'solo flip must paint the destination directly');
  assert.match(guard![0], /flipping = false;/, 'solo flip must release the flipping latch');
  assert.match(guard![0], /return;/, 'solo flip must return before running the leaf animation');
});

test('the solo-flip guard sits BEFORE the leaf-animation branches (dir next/prev)', () => {
  const tsx = source('EditorPort.tsx');
  const guardAt = tsx.indexOf('isSoloSpread(spreads[currentCh], pagesState) || isSoloSpread(spreads[nextIdx]');
  const nextLeafAt = tsx.indexOf("leafFront.classList.toggle('leaf-empty', curRight === null)");
  assert.ok(guardAt > -1 && nextLeafAt > -1, 'expected both the guard and the next-leaf branch');
  assert.ok(
    guardAt < nextLeafAt,
    'the solo direct-switch guard must run before any leaf geometry is set up',
  );
});

// ── Paint ORDER: layout classes must settle before paintEl (the solo↔double bug).

test('paintSpread toggles container/half classes BEFORE paintEl (no painting a still-hidden half)', () => {
  const tsx = source('EditorPort.tsx');
  // paintEl skips a cell hidden by display:none (offsetParent === null). A solo cover/ending
  // collapses the empty half via `.book-single .page-empty{display:none}`. If paintEl ran
  // before the class toggle, a solo→double switch (flipping off the cover) would paint the
  // right page while it was STILL display:none from the previous solo spread → blank page,
  // the exact "can't see page 2 from the cover" regression. So the class toggle must precede.
  const bookSingleAt = tsx.indexOf("toggle('book-single'");
  const paintRightAt = tsx.indexOf('paintEl(pageRight');
  assert.ok(bookSingleAt > -1 && paintRightAt > -1, 'expected book-single toggle and paintEl(pageRight)');
  assert.ok(
    bookSingleAt < paintRightAt,
    'book-single/page-empty toggles must run BEFORE paintEl(pageRight) so the half is at its final visibility/size when painted',
  );
});

// ── CSS box model: book-single narrows the container; the empty half leaves the layout.

test('.book-single narrows the container to single-page aspect (no double-page blank gap)', () => {
  const css = source('editor-port.css');
  const body = ruleBody(css, '.editor-port .book.book-single');
  // Single-page aspect ≈ 0.707/1 (= 1/1.414); the base .book is 1.414/1 (double-page).
  assert.match(
    body,
    /aspect-ratio:\s*0\.707\s*\/\s*1/,
    '.book-single must use single-page aspect (0.707/1), not the double-page 1.414/1',
  );
  // Width must shrink to a single-page bound so the cover renders at one-half scale, centered.
  assert.match(body, /width:\s*min\(/, '.book-single must set a single-page width bound');
});

test('the base .book stays double-page (1.414/1) — only book-single overrides it', () => {
  const css = source('editor-port.css');
  const body = ruleBody(css, '.editor-port .book');
  assert.match(
    body,
    /aspect-ratio:\s*1\.414\s*\/\s*1/,
    'the default spread container must remain double-page width (interior pairs + odd-trailing keep it)',
  );
});

test('inside book-single the empty half leaves the layout so the page fills the container', () => {
  const css = source('editor-port.css');
  const body = ruleBody(css, '.editor-port .book.book-single .page.page-empty');
  assert.match(
    body,
    /display:\s*none/,
    'a cover/ending solo must drop its empty facing half from layout (occupied half fills the single-page container)',
  );
});

test('the display:none on the empty half is SCOPED to book-single (interior odd-trailing keeps its half)', () => {
  const css = source('editor-port.css');
  // There must be no unscoped `.page.page-empty { display:none }` that would also hide the
  // interior odd-trailing blank half. Match rules whose selector ENDS at the page-empty box
  // itself (no descendant after it, e.g. the unrelated `.page-empty .page-num` rule) and that
  // set display:none — every such rule must be scoped to book-single.
  const matches = css.match(/[^{}]*\.page\.page-empty\s*\{[^}]*display:\s*none/g) ?? [];
  for (const m of matches) {
    assert.match(
      m,
      /book-single/,
      'page-empty may only be display:none under .book-single — interior odd-trailing must keep its transparent blank half',
    );
  }
  assert.ok(matches.length >= 1, 'expected the book-single-scoped page-empty display:none rule');
});
