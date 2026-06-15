import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spliceAddedPages } from './job-service';
import type { AlbumLayoutPlanT, PageT, PhotoAnalysisT } from '@/lib/agent/layout-schema';

// W11 mid-edit add-photos: the page-ordering invariant — new content pages land
// just before the (still-last) ending, everything re-indexes contiguously, and the
// photo pool appends. Pure, no DB.

const LAYOUT: AlbumLayoutPlanT = {
  magazine: { title: 'Trip', style: 'warm-film', language: 'en' },
  photos: [
    { photoId: 'old1', description: 'cover', tags: [], quality: 'hero', orientation: 'landscape' },
  ],
  pages: [
    { pageIndex: 0, templateId: 'mag-01', images: { hero: 'old1' }, texts: { title: 'Cover' } },
    { pageIndex: 1, templateId: 'mag-09', images: { hero: 'old1' }, texts: {} },
    { pageIndex: 2, templateId: 'mag-03', images: {}, texts: {} }, // final page
  ],
};

test('splice inserts new pages before the ending and re-indexes contiguously', () => {
  const newPhotos: PhotoAnalysisT[] = [
    { photoId: 'new1', description: 'a', tags: [], quality: 'hero', orientation: 'portrait' },
    { photoId: 'new2', description: 'b', tags: [], quality: 'detail', orientation: 'square' },
  ];
  const newPages: PageT[] = [
    { pageIndex: 0, templateId: 'mag-05', images: { hero: 'new1' }, texts: {} },
    { pageIndex: 1, templateId: 'mag-19', images: { image: 'new2' }, texts: {} },
  ];

  const out = spliceAddedPages(LAYOUT, newPhotos, newPages);

  // Order: cover, body, [new1, new2], final page — final page still last.
  assert.deepEqual(
    out.pages.map((p) => p.templateId),
    ['mag-01', 'mag-09', 'mag-05', 'mag-19', 'mag-03'],
  );
  // Contiguous 0..N-1.
  assert.deepEqual(out.pages.map((p) => p.pageIndex), [0, 1, 2, 3, 4]);
  // The final page is the same page content, just shifted to the new last index.
  assert.equal(out.pages[out.pages.length - 1]?.templateId, 'mag-03');
  // Photos appended.
  assert.deepEqual(out.photos.map((p) => p.photoId), ['old1', 'new1', 'new2']);
  // Original layout is untouched (pure).
  assert.equal(LAYOUT.pages.length, 3);
});

test('splice with a single new page keeps the ending last', () => {
  const onePhoto: PhotoAnalysisT[] = [
    { photoId: 'new1', description: 'a', tags: [], quality: 'fill', orientation: 'square' },
  ];
  const onePage: PageT[] = [{ pageIndex: 0, templateId: 'mag-07', images: { fill: 'new1' }, texts: {} }];
  const out = spliceAddedPages(LAYOUT, onePhoto, onePage);
  assert.deepEqual(out.pages.map((p) => p.templateId), ['mag-01', 'mag-09', 'mag-07', 'mag-03']);
  assert.deepEqual(out.pages.map((p) => p.pageIndex), [0, 1, 2, 3]);
});
