import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Regression guard for issue #153: entering the editor (authoring/editing) must
// NEVER lead with the "out of credits" purchase card (#balanceAlert). Before the
// fix, the mount effect fetched /api/v1/credit/balance and revealed the card when
// balance <= 1 — under the new "1 credit = 1 book" billing that fired for almost
// everyone, so the AI's first chat node looked like a buy-credits demand.
//
// EditorPort is a single large imperative DOM effect with no DOM test harness in
// this repo (tests run under `tsx --test` / node:test, no jsdom). Following the
// repo's existing source-assertion style (see editor-layout.test.ts), we assert
// the two structural invariants the fix relies on.

const here = dirname(fileURLToPath(import.meta.url));

// Chat/interview logic (including the balanceAlert purchase card) moved out of
// EditorPort.tsx into ChatPanel.tsx and the canvas↔chat bridge editor-coordinator.ts.
// These structural guards don't care which of the three a symbol lives in, so a
// request for the editor source returns the three merged; assertions still hit and
// doesNotMatch guards hold across all three.
const EDITOR_SOURCES = ['EditorPort.tsx', 'ChatPanel.tsx', 'editor-coordinator.ts'];
function source(file: string): string {
  if (file === 'EditorPort.tsx') {
    return EDITOR_SOURCES.map((f) => readFileSync(join(here, f), 'utf8')).join('\n\n');
  }
  return readFileSync(join(here, file), 'utf8');
}

test('mount must not actively reveal #balanceAlert from the credit balance', () => {
  const src = source('EditorPort.tsx');

  // (a) The mount-time credit-balance probe that drove the card is gone: no
  //     fetch of the balance endpoint, and no `balance <= 1` reveal heuristic.
  assert.doesNotMatch(
    src,
    /fetch\(\s*['"]\/api\/v1\/credit\/balance['"]/,
    'mount must not fetch the credit balance to decide whether to show the purchase card',
  );
  assert.doesNotMatch(
    src,
    /balance\s*<=\s*1/,
    'the "balance <= 1" mount heuristic that surfaced the purchase card must be removed',
  );

  // (b) The card is still explicitly hidden on entry. Its CSS default is
  //     display:block (.editor-port .balance-alert{ display:block }), so the mount
  //     effect MUST force it hidden or it would render by default in the thread.
  assert.match(
    src,
    /byId\(\s*['"]balanceAlert['"]\s*\)/,
    'mount must still look up #balanceAlert to hide it',
  );
  assert.match(
    src,
    /balanceAlert\.style\.display\s*=\s*['"]none['"]/,
    'mount must keep #balanceAlert hidden by default (CSS default is display:block)',
  );
});

test('#balanceAlert is revealed ONLY on demand via showPurchaseCard()', () => {
  const src = source('EditorPort.tsx');

  // showPurchaseCard() is the single sanctioned path that reveals the card.
  const showPurchase = /function showPurchaseCard\(\)\s*\{[\s\S]*?\n {4}\}/.exec(src);
  assert.ok(showPurchase, 'showPurchaseCard() must exist');
  assert.match(
    showPurchase![0],
    /card\.style\.display\s*=\s*['"]['"]/,
    'showPurchaseCard() reveals the card (sets display back to the CSS default)',
  );

  // And it is wired only behind a caught CreditInsufficientError — i.e. an actual
  // shortfall on a turn (finalize / retry / new generation), never on entry.
  assert.match(
    src,
    /if \(e instanceof CreditInsufficientError\) \{\s*showPurchaseCard\(\);/,
    'showPurchaseCard() must only be called from a CreditInsufficientError catch',
  );
});

test('CSS default for the purchase card is block, so hiding on mount is load-bearing', () => {
  const css = source('editor-port.css');
  assert.match(
    css,
    /\.balance-alert\s*\{\s*display:\s*block;?\s*\}/,
    'guard the assumption: .balance-alert defaults to display:block, so the mount effect must hide it',
  );
});
