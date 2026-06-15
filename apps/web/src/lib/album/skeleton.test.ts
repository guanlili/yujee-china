import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  buildSkeleton,
  canPlace,
  fillCapacity,
  partitionChapterPhotos,
  pickTemplate,
} from './skeleton';

function photo(idx: number, quality: 'hero' | 'detail' | 'fill' = 'fill') {
  const photoId = `p${idx.toString().padStart(3, '0')}`;
  return {
    photoId,
    analysis: {
      photoId,
      description: `photo ${idx}`,
      tags: ['test'],
      quality,
      orientation: 'portrait' as const,
      peopleCount: '1' as const,
      scene: 'indoor' as const,
      mood: 'quiet' as const,
    },
    exif: { order: idx },
    used: true,
  };
}

test('partition repairs all-fill 3-up chunks and preserves every photo once', () => {
  const pages = partitionChapterPhotos(Array.from({ length: 30 }, (_, i) => photo(i + 1)));

  assert.deepEqual(
    pages.map((page) => page.length),
    Array.from({ length: 10 }).flatMap(() => [2, 1]),
  );
  assert.deepEqual(
    pages.flat().map((p) => p.photoId),
    Array.from({ length: 30 }, (_, i) => `p${(i + 1).toString().padStart(3, '0')}`),
  );
  for (const page of pages) {
    const fillCount = page.filter((p) => p.analysis.quality === 'fill').length;
    assert.ok(fillCount <= fillCapacity('chapter', page.length));
  }
});

test('chapter 1-up template picking excludes cover and closing templates', () => {
  const forbidden = new Set(['mag-01', 'mag-13', 'p01']);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    assert.equal(
      forbidden.has(
        pickTemplate({
          useCase: 'chapter',
          imageCount: 1,
          photos: [photo(1, 'detail')],
          albumId: 'album',
          chapterId: 'chapter',
          pageOrdinal: 0,
          attempt,
        }),
      ),
      false,
    );
  }
});

test('can_place filters fill photos out of hero-only chapter slots', () => {
  assert.equal(
    pickTemplate({
      useCase: 'chapter',
      imageCount: 1,
      photos: [photo(1, 'fill')],
      albumId: 'album',
      chapterId: 'chapter',
      pageOrdinal: 0,
    }),
    'mag-19',
  );
  assert.equal(
    pickTemplate({
      useCase: 'chapter',
      imageCount: 2,
      photos: [photo(1, 'fill'), photo(2, 'fill')],
      albumId: 'album',
      chapterId: 'chapter',
      pageOrdinal: 0,
    }),
    'mag-18',
  );
});

test('seeded pick is reproducible and attempt rerolls are reversible', () => {
  const args = {
    useCase: 'chapter' as const,
    imageCount: 1,
    photos: [photo(1, 'detail')],
    albumId: 'album-seed',
    chapterId: 'chapter-seed',
    pageOrdinal: 2,
  };

  const original = pickTemplate({ ...args, attempt: 0 });
  const rerolled = pickTemplate({ ...args, attempt: 1 });

  assert.equal(original, pickTemplate({ ...args, attempt: 0 }));
  assert.equal(rerolled, pickTemplate({ ...args, attempt: 1 }));
  assert.notEqual(original, rerolled);
});

test('exclude exhaustion falls back to legal candidates', () => {
  const photos = [photo(1, 'hero'), photo(2, 'fill'), photo(3, 'fill')];
  const templateId = pickTemplate({
    useCase: 'chapter',
    imageCount: 3,
    photos,
    exclude: new Set(['mag-04']),
    albumId: 'album',
    chapterId: 'chapter',
    pageOrdinal: 0,
  });

  assert.equal(templateId, 'mag-04');
  assert.equal(canPlace(templateId, photos), true);
});

test('shared golden fixtures match TypeScript output byte-for-byte', () => {
  const fixtureDir = path.resolve(process.cwd(), '../../packages/contracts/fixtures/skeleton');

  for (const fileName of readdirSync(fixtureDir).filter((name) => name.endsWith('.json')).sort()) {
    const fixture = JSON.parse(readFileSync(path.join(fixtureDir, fileName), 'utf8'));
    const result = buildSkeleton(fixture.input);

    assert.equal(
      JSON.stringify(result),
      JSON.stringify(fixture.expected),
      fileName,
    );
  }
});
