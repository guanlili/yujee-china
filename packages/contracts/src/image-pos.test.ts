import assert from 'node:assert/strict';
import test from 'node:test';

import { Focal, ImagePos, Page, PhotoAnalysis } from './layout';

// #165 Phase 1: ImagePos clamp bounds + Page.imagePos optionality. Mirrors the
// Python parity tests in apps/agent/tests/test_image_pos_parity.py.

// #169: Focal (0..1) + PhotoAnalysis.focal optionality.
test('Focal accepts [0,1] and rejects out-of-range', () => {
  assert.equal(Focal.safeParse({ x: 0, y: 1 }).success, true);
  assert.equal(Focal.safeParse({ x: 0.5, y: 0.5 }).success, true);
  assert.equal(Focal.safeParse({ x: -0.1, y: 0.5 }).success, false);
  assert.equal(Focal.safeParse({ x: 0.5, y: 1.1 }).success, false);
});

const basePhoto = {
  photoId: 'p1',
  description: 'a',
  tags: ['x'],
  quality: 'hero',
  orientation: 'portrait',
} as const;

test('PhotoAnalysis.focal is optional (absent ok) and validated when present', () => {
  assert.equal(PhotoAnalysis.safeParse(basePhoto).success, true);
  assert.equal(PhotoAnalysis.safeParse({ ...basePhoto, focal: { x: 0.2, y: 0.8 } }).success, true);
  assert.equal(PhotoAnalysis.safeParse({ ...basePhoto, focal: { x: 2, y: 0.8 } }).success, false);
});

test('ImagePos accepts in-range values', () => {
  assert.equal(ImagePos.safeParse({ x: 0, y: 100, scale: 1 }).success, true);
  assert.equal(ImagePos.safeParse({ x: 50, y: 50, scale: 2 }).success, true);
});

test('ImagePos rejects out-of-range x/y/scale', () => {
  assert.equal(ImagePos.safeParse({ x: -1, y: 50, scale: 1 }).success, false);
  assert.equal(ImagePos.safeParse({ x: 101, y: 50, scale: 1 }).success, false);
  assert.equal(ImagePos.safeParse({ x: 50, y: 50, scale: 0.9 }).success, false);
  assert.equal(ImagePos.safeParse({ x: 50, y: 50, scale: 2.5 }).success, false);
});

test('Page.imagePos is optional — absent parses (default path unchanged)', () => {
  const ok = Page.safeParse({ pageIndex: 0, templateId: 'mag-08', images: {}, texts: {} });
  assert.equal(ok.success, true);
  if (ok.success) assert.equal(ok.data.imagePos, undefined);
});

test('Page.imagePos accepts a per-slot override map keyed by slotId', () => {
  const parsed = Page.safeParse({
    pageIndex: 1,
    templateId: 'mag-10',
    images: { 'cells[0].image': 'p1' },
    texts: {},
    imagePos: { 'cells[0].image': { x: 20, y: 80, scale: 1.4 } },
  });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.imagePos?.['cells[0].image']?.scale, 1.4);
});

test('Page.imagePos rejects an out-of-range entry', () => {
  const bad = Page.safeParse({
    pageIndex: 0,
    templateId: 'mag-08',
    images: { image: 'p1' },
    texts: {},
    imagePos: { image: { x: 50, y: 50, scale: 9 } },
  });
  assert.equal(bad.success, false);
});
