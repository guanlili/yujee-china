import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoFilterState } from '@/lib/photo/filter-state';
import {
  clearPhotoOverride,
  collectSnapshotEntries,
  createLatestCommit,
  createOwnedUrlController,
  filterSnapshotMismatches,
  setBookFilter,
  setPhotoOverride,
} from './filter-controller';

const book: PhotoFilterState = {
  default: { lutId: 'cloudy-cool', strength: 80 },
  overrides: {
    p1: { lutId: 'fuji-portrait', strength: 60 },
    p2: null,
  },
};

test('book default changes preserve every photo override', () => {
  assert.deepEqual(
    setBookFilter(book, { lutId: 'street-negative', strength: 75 }),
    {
      default: { lutId: 'street-negative', strength: 75 },
      overrides: book.overrides,
    },
  );
});

test('setting one override changes only that key and explicit null means original', () => {
  const changed = setPhotoOverride(book, 'p1', { lutId: 'daily-soft', strength: 55 });
  assert.deepEqual(changed.overrides, {
    p1: { lutId: 'daily-soft', strength: 55 },
    p2: null,
  });
  assert.deepEqual(setPhotoOverride(book, 'p3', null).overrides?.p3, null);
});

test('clearing deletes the key and drops an empty overrides object', () => {
  const one: PhotoFilterState = {
    default: { lutId: 'cloudy-cool', strength: 80 },
    overrides: { p1: null },
  };
  assert.deepEqual(clearPhotoOverride(one, 'p1'), {
    default: { lutId: 'cloudy-cool', strength: 80 },
  });
  assert.equal(Object.hasOwn(clearPhotoOverride(book, 'p1').overrides ?? {}, 'p1'), false);
});

test('snapshot collection is deduped, versioned, and mismatch-only', () => {
  const entries = collectSnapshotEntries(['p1', 'p2', 'p1', 'p3'], book);
  assert.deepEqual(entries, [
    { photoId: 'p1', renderVersion: 'pf-v1__fuji-portrait__60' },
    { photoId: 'p2', renderVersion: 'pf-v1__original' },
    { photoId: 'p3', renderVersion: 'pf-v1__cloudy-cool__80' },
  ]);
  assert.deepEqual(
    filterSnapshotMismatches(entries, {
      p1: 'pf-v1__fuji-portrait__60',
      p2: 'pf-v1__cloudy-cool__80',
    }),
    entries.slice(1),
  );
});

test('latest async commit ignores stale completions and disposal', async () => {
  const commits: number[] = [];
  const latest = createLatestCommit<number>((value) => commits.push(value));
  const first = latest.run(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return 1;
  });
  await latest.run(async () => 2);
  await first;
  latest.dispose();
  await latest.run(async () => 3);
  assert.deepEqual(commits, [2]);
});

test('preview URL ownership revokes regeneration, stale, and disposal URLs', () => {
  const revoked: string[] = [];
  const owner = createOwnedUrlController((url) => revoked.push(url));
  const first = owner.start();
  assert.equal(owner.own(first, 'blob:first'), true);
  const second = owner.start();
  assert.deepEqual(revoked, ['blob:first']);
  assert.equal(owner.own(first, 'blob:stale'), false);
  assert.equal(owner.own(second, 'blob:second'), true);
  owner.dispose();
  assert.deepEqual(revoked, ['blob:first', 'blob:stale', 'blob:second']);
});
