import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Guard for the "insufficient credits → in-editor purchase modal" change: the chat
// rail must no longer NAVIGATE to /credits, it must open an in-editor modal that
// checks out in a new tab and polls the balance until the top-up lands. Repo tests
// run under `tsx --test` (no jsdom), so these are source-assertion guards like the
// sibling balance-alert-on-mount.test.ts.

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, f), 'utf8');
const chat = read('ChatPanel.tsx');
const modal = read('CreditsPurchaseModal.tsx');
const css = read('editor-port.css');

test('buyShells opens the modal, never navigates the editor tab to /credits', () => {
  // The old whole-page jump must be gone.
  assert.doesNotMatch(
    chat,
    /window\.location\.href\s*=\s*`\/\$\{locale\}\/credits`/,
    'buyShells must not window.location to /credits anymore',
  );
  assert.doesNotMatch(
    chat,
    /buyShells:\s*\(\)\s*=>\s*\{\s*window\.location/,
    'buyShells must not navigate at all',
  );
  // buyShells now opens the in-editor modal (covers both #balanceAlert "去购买" and any
  // showPurchaseCard surface, since both route through this one data-action).
  assert.match(
    chat,
    /buyShells:\s*\(\)\s*=>\s*\{\s*setCreditsModalOpen\(true\)/,
    'buyShells must open the purchase modal',
  );
});

test('ChatPanel renders the modal and re-enables sending on top-up', () => {
  assert.match(chat, /<CreditsPurchaseModal/, 'modal must be rendered by ChatPanel');
  assert.match(chat, /onToppedUp=\{/, 'modal must be wired to a top-up callback');

  // The top-up handler undoes showPurchaseCard(): hide #balanceAlert + re-enable #sendBtn.
  const handler = /toppedUpHandlerRef\.current = \(\) => \{[\s\S]*?\n {4}\};/.exec(chat);
  assert.ok(handler, 'toppedUpHandlerRef.current handler must exist');
  assert.match(handler![0], /balanceAlert/, 'top-up handler must hide #balanceAlert');
  // Re-enable is now routed through the single disable source (outOfCredits + refreshSendDisabled)
  // so "still busy after top-up" keeps the button disabled — never a direct send.disabled poke.
  assert.match(
    handler![0],
    /outOfCredits = false;\s*\n\s*refreshSendDisabled\(\)/,
    'top-up handler must clear outOfCredits and refresh the send-button disabled state',
  );
  assert.doesNotMatch(
    handler![0],
    /send\.disabled\s*=/,
    'top-up handler must not poke send.disabled directly anymore',
  );
});

test('modal is a body-level portal that reliably covers the viewport', () => {
  assert.match(modal, /createPortal\(/, 'modal must use createPortal');
  assert.match(modal, /document\.body/, 'modal must portal to document.body (dodge transformed ancestors)');
  assert.match(modal, /data-credits-modal/, 'modal root must carry the data-credits-modal marker');
  // SSR guard: the editor is server-rendered, so document.body is only touched post-mount.
  assert.match(modal, /if \(!mounted\) return null;/, 'modal must gate the portal behind client mount');
});

test('packs + "≈ N photos" derive from ADDON_PACKS / PHOTOS_PER_CREDIT — never hardcoded', () => {
  assert.match(
    modal,
    /import\s*\{\s*ADDON_PACKS,\s*PHOTOS_PER_CREDIT\s*\}\s*from\s*'@\/config\/pricing'/,
    'modal must import ADDON_PACKS + PHOTOS_PER_CREDIT from the single price source',
  );
  assert.match(modal, /ADDON_PACKS\.map\(/, 'pack rows must be mapped from ADDON_PACKS, not written out');
  assert.match(
    modal,
    /pack\.books \* PHOTOS_PER_CREDIT/,
    'the "≈ N photos" figure must be derived as books * PHOTOS_PER_CREDIT',
  );
  // The derived products (4→80, 10→200) must NOT be baked in as literals.
  assert.doesNotMatch(modal, /\b80\b/, 'photo count 80 must be derived, not hardcoded');
  assert.doesNotMatch(modal, /\b200\b/, 'photo count 200 must be derived, not hardcoded');
  // Default selection is the 10-credit pack.
  assert.match(modal, /DEFAULT_PACK_ID\s*=\s*'pack-10'/, 'the 10-credit pack must be default-selected');
});

test('checkout opens a NEW tab (spec) and matches credits/page.tsx contract', () => {
  assert.match(
    modal,
    /fetch\('\/api\/v1\/billing\/checkout',/,
    'modal must POST the same checkout endpoint as the credits page',
  );
  assert.match(modal, /from:\s*'album'/, "checkout must tag the source as 'album'");
  assert.match(modal, /packId:\s*selectedId/, 'checkout must send the selected packId');
  assert.match(
    modal,
    /window\.open\(\s*url,\s*'_blank'\s*\)/,
    'payment must open in a new tab so the editor tab never navigates',
  );
  // Popup-blocked fallback must not navigate the editor tab (no same-tab redirect).
  assert.doesNotMatch(modal, /window\.location\.href\s*=\s*url/, 'must not same-tab redirect on popup block');
});

test('balance polling: baseline on open, capped, and torn down', () => {
  assert.match(modal, /fetch\('\/api\/v1\/credit\/balance'\)/, 'modal must poll the balance endpoint');
  assert.match(modal, /baselineRef/, 'modal must capture a baseline balance to compare against');
  assert.match(modal, /bal > base/, 'top-up = balance strictly above the opening baseline');
  assert.match(modal, /BALANCE_POLL_MS\s*=\s*3000/, 'poll cadence must be ~3s');
  assert.match(modal, /POLL_CAP_MS\s*=\s*5 \* 60 \* 1000/, 'polling must be capped at 5 minutes');
  assert.match(modal, /clearTimeout\(timer\)/, 'the poll loop must be cleaned up (no dangling timers)');
  // A manual "I've paid — refresh" fallback exists.
  assert.match(modal, /manualRefresh/, 'a manual refresh fallback must exist');
});

test('modal CSS is unscoped (body portal) and follows the confirmed visual spec', () => {
  // NOT scoped under .editor-port — the portal lives on <body>.
  assert.match(css, /\n\.credits-modal-overlay\{/, '.credits-modal-overlay must be a top-level (unscoped) rule');
  assert.match(css, /\.credits-modal-overlay\.open/, 'reuses the .open reveal convention');
  // Pure-black CTA off --fg (like .buy-banner-btn).
  const cta = /\.credits-modal-cta\{[^}]*\}/.exec(css);
  assert.ok(cta, '.credits-modal-cta rule must exist');
  assert.match(cta![0], /background:var\(--fg\)/, 'CTA must be the black --fg button');
  // The single "most popular" badge uses the cc-tag three-color gradient.
  assert.match(css, /\.credits-pack-badge\{/, 'the "most popular" badge rule must exist');
  // Dark mode is provided (app has no theme system → OS preference).
  assert.match(
    css,
    /@media \(prefers-color-scheme:dark\)\{[\s\S]*?\.credits-modal-overlay\{/,
    'a dark-mode variant must be provided for the modal',
  );
});
