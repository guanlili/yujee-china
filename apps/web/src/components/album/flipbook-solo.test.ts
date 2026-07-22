import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// FlipBook is the 3D flip preview surface. Cover (recto) and ending (verso) each
// land on their own spread; they must render as ONE centered page — no blank
// facing half, no center spine — instead of "a page + a white blank page".
//
// The trap (and the regression these guards pin): an interior odd-trailing page
// also lands as { left: i, right: null } — the SAME shape as an ending — but its
// blank half is normal spread whitespace and must stay a double-width spread.
// So the solo decision is made by isSoloSpread (category-driven), never by
// "a half is null". buildSpreads/isSoloSpread own that logic and are unit-tested
// in spreads.test.ts; here — following the repo's source-assertion style for big
// client components with no jsdom harness (see editor-v2/spread-page-padding.test.ts)
// — we pin the FlipBook wiring that turns that classification into the render.

const here = dirname(fileURLToPath(import.meta.url));

function source(file: string): string {
  return readFileSync(join(here, file), 'utf8');
}

test('FlipBook classifies solo via isSoloSpread (category-driven), not a raw null half', () => {
  const tsx = source('FlipBook.tsx');
  assert.match(
    tsx,
    /import\s*\{[^}]*\bisSoloSpread\b[^}]*\}\s*from\s*'\.\/spreads'/,
    'FlipBook must import isSoloSpread from ./spreads (the shared category-driven solo test)',
  );
  assert.match(
    tsx,
    /isSoloSpread\(spreads\[spread\],\s*pages\)/,
    'the resting spread must be classified through isSoloSpread(spreads[spread], pages)',
  );
});

test('a solo spread renders a single centered page at half width, no spine, one Half', () => {
  const tsx = source('FlipBook.tsx');

  // The solo book branch is gated on soloHere and sizes the container to halfW
  // (a single page), not the full book.w (a two-up spread).
  const soloBranch = /book\.w > 0 && soloHere &&[\s\S]*?width:\s*halfW/;
  assert.match(
    tsx,
    soloBranch,
    'the solo book container must use width: halfW (single page), not book.w',
  );

  // The non-solo (double-page) branch is the one that still draws the spine + leaf.
  assert.match(
    tsx,
    /book\.w > 0 && !soloHere &&[\s\S]*?width:\s*book\.w/,
    'the double-page branch must keep width: book.w',
  );

  // Center spine shadow must live ONLY in the !soloHere double-page branch — a
  // solo page has no spine. Assert the spine gradient appears after the !soloHere
  // gate and that the solo branch above it does not contain it.
  const soloMatch = /book\.w > 0 && soloHere &&([\s\S]*?)\)\}\n\n\s*\{book\.w > 0 && !soloHere/.exec(tsx);
  assert.ok(soloMatch, 'expected the solo branch to be immediately followed by the !soloHere branch');
  assert.doesNotMatch(
    soloMatch![1],
    /center spine shadow|linear-gradient\(90deg, rgba\(0,0,0,0\)/,
    'the solo branch must not render the center spine',
  );
  assert.doesNotMatch(
    soloMatch![1],
    /turning leaf|leafFront/,
    'the solo branch must not render the turning leaf',
  );
});

test('page-turn into/out of a solo OR full edge skips the cross-width leaf flip (direct switch)', () => {
  const tsx = source('FlipBook.tsx');
  // goToSpread short-circuits to a direct setSpread when either end is solo, so a
  // half-width leaf is never flown across a width change (no tear / blank flash).
  // #303 收紧(不是放松):双宽跨页也必须走这条直切路径 —— 它是一整张连续的双宽面,
  // 没有可以当叶子转的右半页。
  //
  // review 加固(repeat-offense fix): a prior version pinned this via
  // `cond.includes(term)` substring checks across five terms — substring
  // containment says nothing about the operator JOINING those terms, so
  // `reducedMotion || soloOf(spread) && soloOf(to) || ...` (an `&&` slipped in,
  // which binds tighter than `||` and silently skips the leaf-flip guard for a
  // solo-source/paired-target move) would still pass. The OR logic now lives in
  // shouldDirectSwitch — a real, exported, unit-tested pure predicate (see
  // spreads.test.ts, which drives actual boolean inputs through it and cannot be
  // fooled by operator precedence at all). This test only pins the WIRING: each
  // of the five reasons must be its own positional argument, not folded into a
  // combined boolean expression before being handed to shouldDirectSwitch.
  assert.match(
    tsx,
    /import\s*\{[^}]*\bshouldDirectSwitch\b[^}]*\}\s*from\s*'\.\/spreads'/,
    'FlipBook must import shouldDirectSwitch from ./spreads (the shared, unit-tested direct-switch predicate)',
  );
  const guard =
    /\n\s*if \(\s*\n\s*shouldDirectSwitch\(([\s\S]*?)\)\s*\n\s*\) \{\n\s*setSpread\(to\);\n\s*return;\n/.exec(tsx);
  assert.ok(guard, 'expected goToSpread to short-circuit via shouldDirectSwitch(...) with a direct setSpread(to)');
  const args = guard![1]!.split(',').map((s) => s.trim());
  assert.deepEqual(
    args,
    ['reducedMotion', 'soloOf(spread)', 'soloOf(to)', 'fullIndexOf(spread) >= 0', 'fullIndexOf(to) >= 0'],
    `each reason must be its own positional argument to shouldDirectSwitch (never combined with && or ||) — args were: ${guard![1]}`,
  );
});

test('the thumbnail strip renders a solo spread as one page, no spine divider', () => {
  const tsx = source('FlipBook.tsx');
  // Each thumbnail computes solo = soloOf(s); the solo branch renders a single
  // full-width PageFace and omits the spine divider.
  assert.match(tsx, /const solo = soloOf\(s\)/, 'thumbnail must classify each spread via soloOf');
  assert.match(
    tsx,
    /solo \? 'w-\[26px\]' : 'w-\[52px\]'/,
    'a solo thumbnail must be single-page width (26px), not the full 52px spread',
  );
  // The spine divider (border-soft vertical line) must sit in the non-solo branch.
  const thumbBlock = /\{solo \? \([\s\S]*?\) : \(([\s\S]*?)\)\}\n\s*<\/div>\n\s*<\/button>/.exec(tsx);
  assert.ok(thumbBlock, 'expected the thumbnail solo/non-solo ternary');
  assert.match(
    thumbBlock![1],
    /background:\s*'var\(--border-soft\)'/,
    'the spine divider must live only in the non-solo thumbnail branch',
  );
  assert.doesNotMatch(
    /\{solo \? \(([\s\S]*?)\) : \(/.exec(tsx)![1],
    /var\(--border-soft\)/,
    'the solo thumbnail branch must not draw a spine divider',
  );
});
