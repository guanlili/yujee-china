import assert from 'node:assert/strict';
import test from 'node:test';

import { applyPatchToPages, type EditorPage } from './types';

// #165: applyPatchToPages must keep imagePosJson per slot, clear a slot's
// override when its photoId changes (photo-swap reset), reset all overrides on
// a template swap, and honor an explicit imagePos patch.

function page(over: Partial<EditorPage> = {}): EditorPage {
  return {
    pageIndex: 0,
    templateId: 'mag-08',
    imagesJson: { image: 'photo-A' },
    textsJson: { title: 'T' },
    imagePosJson: { image: { x: 20, y: 80, scale: 1.4 } },
    ...over,
  };
}

test('text-only patch preserves the slot position override', () => {
  const out = applyPatchToPages([page()], [{ pageIndex: 0, textsJson: { title: 'New' } }]);
  assert.deepEqual(out[0]!.imagePosJson, { image: { x: 20, y: 80, scale: 1.4 } });
});

test('swapping a slot photo clears that slot override (new subject ⇒ 50/50/1)', () => {
  const out = applyPatchToPages([page()], [{ pageIndex: 0, imagesJson: { image: 'photo-B' } }]);
  assert.equal(out[0]!.imagesJson.image, 'photo-B');
  assert.equal(out[0]!.imagePosJson?.image, undefined);
});

test('re-sending the SAME photo keeps the override (no spurious reset)', () => {
  const out = applyPatchToPages([page()], [{ pageIndex: 0, imagesJson: { image: 'photo-A' } }]);
  assert.deepEqual(out[0]!.imagePosJson, { image: { x: 20, y: 80, scale: 1.4 } });
});

test('template swap resets all position overrides', () => {
  const out = applyPatchToPages(
    [page()],
    [{ pageIndex: 0, templateId: 'mag-01', imagesJson: { image: 'photo-A' }, textsJson: {} }],
  );
  assert.deepEqual(out[0]!.imagePosJson, {});
});

test('an explicit imagePos patch is applied (Phase 3 adjust path)', () => {
  const out = applyPatchToPages(
    [page({ imagePosJson: {} })],
    [{ pageIndex: 0, imagePosJson: { image: { x: 10, y: 10, scale: 2 } } }],
  );
  assert.deepEqual(out[0]!.imagePosJson, { image: { x: 10, y: 10, scale: 2 } });
});

test('imagePos patch wins even alongside an images swap on the same slot', () => {
  const out = applyPatchToPages(
    [page()],
    [
      {
        pageIndex: 0,
        imagesJson: { image: 'photo-B' },
        imagePosJson: { image: { x: 5, y: 5, scale: 1 } },
      },
    ],
  );
  // swap clears, then the explicit patch re-sets it
  assert.deepEqual(out[0]!.imagePosJson, { image: { x: 5, y: 5, scale: 1 } });
});
