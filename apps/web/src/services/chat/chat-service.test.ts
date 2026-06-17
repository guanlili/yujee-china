import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __test__ } from '@/services/chat/chat-service';
import type { AlbumLayoutPlanT } from '@/lib/agent/layout-schema';
import type { LayoutPatchEntry } from '@/lib/agent/agent-client';

const { applyPatch, toBrowserPatch } = __test__;

// #165 D1: the finalize-era chat-edit path (applyPatch + toBrowserPatch) must
// thread imagePos through, or an existing per-slot override is silently stripped
// on every chat edit. These are pure-function regression tests (no DB).

function layout(over: Partial<AlbumLayoutPlanT['pages'][number]> = {}): AlbumLayoutPlanT {
  return {
    magazine: { title: 'T', style: 'warm-film', language: 'en' },
    photos: [],
    pages: [
      {
        pageIndex: 0,
        templateId: 'mag-08',
        images: { image: 'photo-A' },
        texts: { title: 'Old' },
        imagePos: { image: { x: 20, y: 80, scale: 1.4 } },
        ...over,
      },
    ],
  };
}

test('applyPatch keeps an existing imagePos when only texts change (D1)', () => {
  const out = applyPatch(layout(), [{ pageIndex: 0, texts: { title: 'New' } }]);
  assert.deepEqual(out.pages[0]!.imagePos, { image: { x: 20, y: 80, scale: 1.4 } });
  assert.equal(out.pages[0]!.texts.title, 'New');
});

test('applyPatch merges an explicit imagePos patch into the slot map (D1)', () => {
  const out = applyPatch(layout(), [
    { pageIndex: 0, imagePos: { image: { x: 10, y: 10, scale: 2 } } } as LayoutPatchEntry,
  ]);
  assert.deepEqual(out.pages[0]!.imagePos, { image: { x: 10, y: 10, scale: 2 } });
});

test('applyPatch resets imagePos on a template swap', () => {
  const out = applyPatch(layout(), [
    { pageIndex: 0, templateId: 'mag-01', images: { image: 'photo-A' }, texts: {} },
  ]);
  assert.equal(out.pages[0]!.imagePos, undefined);
});

test('toBrowserPatch carries imagePos through as imagePosJson (D1)', () => {
  const patch: LayoutPatchEntry[] = [
    { pageIndex: 0, imagePos: { image: { x: 30, y: 40, scale: 1.5 } } },
  ];
  const browser = toBrowserPatch(patch);
  assert.deepEqual(browser[0], {
    pageIndex: 0,
    imagePosJson: { image: { x: 30, y: 40, scale: 1.5 } },
  });
});

test('toBrowserPatch omits imagePosJson when the entry has no imagePos', () => {
  const browser = toBrowserPatch([{ pageIndex: 0, texts: { title: 'x' } }]);
  assert.equal('imagePosJson' in browser[0]!, false);
});
