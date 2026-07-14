import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Thinking ⇔「水母浮动」idle indicator are MUTUALLY EXCLUSIVE.
//
// The chat rail has two jellyfish visuals:
//   • the THINKING spinner — `.think-jelly` inside a `.thinking-block.active`, shown while
//     the AI is processing a round-trip (appendThinkingShell).
//   • the IDLE float — `#awaitUser` / `.await-jelly` (ep-jelly-float keyframes), shown only
//     when the AI is done, needs no further action, and is waiting for the user to speak
//     (restAwait / hideAwait).
//
// The bug: these two could appear at the same time (the idle float kept floating while a
// thinking block was active) because hideAwait()/restAwait() were paired by hand at each
// call site and several thinking entry points forgot the hideAwait() half.
//
// EditorPort is one large imperative DOM effect with no jsdom harness in this repo (tests
// run under tsx/node:test), so — following the repo's source-assertion style
// (chapter-guide-satisfaction.test.ts, balance-alert-on-mount.test.ts) — we lock the
// invariant at the two chokepoints every path funnels through, rather than re-checking
// every individual caller.

const here = dirname(fileURLToPath(import.meta.url));
// Chat/interview logic moved out of EditorPort.tsx into ChatPanel.tsx and the
// canvas↔chat bridge editor-coordinator.ts. These structural guards don't care
// which of the three a symbol lives in, so a request for the editor source returns
// the three merged; assertions still hit and doesNotMatch guards hold across all three.
const EDITOR_SOURCES = ['EditorPort.tsx', 'ChatPanel.tsx', 'editor-coordinator.ts'];
function source(file: string): string {
  if (file === 'EditorPort.tsx') {
    return EDITOR_SOURCES.map((f) => readFileSync(join(here, f), 'utf8')).join('\n\n');
  }
  return readFileSync(join(here, file), 'utf8');
}

// Slice from a function's signature to the next top-level `function ` declaration (these
// helpers all sit at the same indentation inside the mount effect). Robust to nested `}` in
// template literals, which a brace-balanced regex trips over.
function fnBody(src: string, signature: RegExp): string {
  const start = signature.exec(src);
  assert.ok(start, `could not find ${signature}`);
  const from = start!.index;
  const rest = src.slice(from + start![0].length);
  // Stop at the next sibling statement at the same (4-space) indentation — either another
  // function declaration or a top-level call/assignment — so a short helper isn't slurped
  // into the following one.
  const next = /\n {4}(?:(?:async )?function \w|const |let |\w+[?.])/.exec(rest);
  return rest.slice(0, next ? next.index : rest.length);
}

test('entering a thinking state always hides the idle float (appendThinkingShell → hideAwait)', () => {
  const src = source('EditorPort.tsx');

  // Every thinking round-trip funnels through appendThinkingShell(). It must hide the idle
  // float on entry so the float never coexists with the active thinking spinner — no matter
  // which path triggered it (chat turn / opener / recommend / apply-theme / cover / advance).
  const body = fnBody(src, /function appendThinkingShell\(\)/);
  assert.match(body, /hideAwait\(\)/, 'appendThinkingShell() must call hideAwait() so the idle float is gone while thinking');
  // It still builds the active thinking block (sanity: we matched the right function).
  assert.match(body, /thinking-block active/, 'appendThinkingShell() must build an active thinking block');
});

test('restAwait() refuses to show the float while a thinking block is still active', () => {
  const src = source('EditorPort.tsx');

  // restAwait() is the ONLY way the idle float is shown; the trailing restAwait() in the
  // finally-block of each turn must not re-show the float if a thinking block is still active
  // (the round-trip hasn't settled). Guarding here makes the invariant hold regardless of
  // ordering at the call sites.
  const body = fnBody(src, /function restAwait\(\)/);
  assert.match(
    body,
    /querySelector\(\s*['"]\.thinking-block\.active['"]\s*\)/,
    'restAwait() must check for an active thinking block before showing the idle float',
  );
});

test('the idle float and the thinking spinner are distinct elements (no shared toggle)', () => {
  const src = source('EditorPort.tsx');

  // The idle float is #awaitUser / .await-jelly; the thinking spinner is .think-jelly inside
  // an active .thinking-block. They are different DOM nodes (the mutual-exclusion is enforced
  // by show/hide logic, not by reusing one node), so both must exist in the source.
  assert.match(src, /id="awaitUser"/, 'the idle float (#awaitUser) must exist');
  assert.match(src, /class="await-jelly"|className="await-jelly"/, 'the idle float jellyfish (.await-jelly) must exist');
  assert.match(src, /class="think-jelly"/, 'the thinking spinner jellyfish (.think-jelly) must exist');
});

test('the idle-float CSS animation and the thinking dots are separate keyframes', () => {
  const css = source('editor-port.css');

  // The float animation belongs to the idle indicator only.
  assert.match(css, /@keyframes ep-jelly-float/, 'the idle float keyframes (ep-jelly-float) must exist');
  assert.match(css, /\.await-jelly\{[^}]*ep-jelly-float/, '.await-jelly must use the ep-jelly-float animation');
});
