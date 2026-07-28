import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoFilterState } from '@/lib/photo/filter-state';
import {
  clearPhotoOverride,
  collectSnapshotEntries,
  correlateSignedSnapshotUploads,
  createFilterSaveController,
  createFrozenBackupPlan,
  createLatestCommit,
  createOwnedUrlController,
  filterSnapshotMismatches,
  prepareSnapshotBlobs,
  runFilterPreviewGeneration,
  setBookFilter,
  setPhotoOverride,
  uploadCorrelatedSnapshots,
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

test('public transforms normalize and quantize every ref', () => {
  assert.equal(setBookFilter(null, { lutId: 'cloudy-cool', strength: 78 }).default?.strength, 80);
  assert.equal(
    setPhotoOverride(
      { default: { lutId: 'daily-soft', strength: 62 } },
      'p1',
      { lutId: 'fuji-portrait', strength: 57 },
    ).overrides?.p1?.strength,
    55,
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

test('preview exact-base failure revokes partial URLs and retry can succeed', async () => {
  const revoked: string[] = [];
  const owner = createOwnedUrlController((url) => revoked.push(url));
  let urlNo = 0;
  const base = new Blob(['base']);
  let calls = 0;
  const failed = await runFilterPreviewGeneration({
    photoId: 'p1',
    strength: 80,
    generation: owner.start(),
    owner,
    getBase: async () => base,
    applyPreview: async () => (++calls === 2 ? base : new Blob([String(calls)])),
    createUrl: () => `blob:${++urlNo}`,
  });
  assert.equal(failed.status, 'error');
  assert.deepEqual(revoked, ['blob:1', 'blob:2']);

  const retried = await runFilterPreviewGeneration({
    photoId: 'p1',
    strength: 80,
    generation: owner.start(),
    owner,
    getBase: async () => base,
    applyPreview: async () => new Blob(['ok']),
    createUrl: () => `blob:${++urlNo}`,
  });
  assert.equal(retried.status, 'ready');
  assert.equal(retried.status === 'ready' ? Object.keys(retried.urls).length : 0, 27);
  owner.dispose();
});

test('preview treats an exact base Blob as failure even at zero strength', async () => {
  const revoked: string[] = [];
  const owner = createOwnedUrlController((url) => revoked.push(url));
  const base = new Blob(['base']);
  const result = await runFilterPreviewGeneration({
    photoId: 'p1',
    strength: 0,
    generation: owner.start(),
    owner,
    getBase: async () => base,
    applyPreview: async () => base,
    createUrl: () => 'blob:original',
  });
  assert.equal(result.status, 'error');
  assert.deepEqual(revoked, ['blob:original']);
});

test('stale preview selection immediately cleans partial URLs and never commits', async () => {
  const revoked: string[] = [];
  const owner = createOwnedUrlController((url) => revoked.push(url));
  const base = new Blob(['base']);
  let release!: (blob: Blob) => void;
  const pending = new Promise<Blob>((resolve) => { release = resolve; });
  const generation = owner.start();
  const result = runFilterPreviewGeneration({
    photoId: 'p1',
    strength: 80,
    generation,
    owner,
    getBase: async () => base,
    applyPreview: async () => pending,
    createUrl: () => 'blob:partial',
  });
  await Promise.resolve();
  owner.invalidate(generation);
  release(new Blob(['late']));
  assert.equal((await result).status, 'stale');
  assert.deepEqual(revoked, ['blob:partial']);
});

test('180ms filter saver coalesces and suppresses stale, aborted, and disposed results', async () => {
  const timers = new Map<number, () => void>();
  const delays: number[] = [];
  let nextTimer = 0;
  const pending = new Map<number, {
    resolve: (state: PhotoFilterState | null) => void;
    signal: AbortSignal;
  }>();
  let saveNo = 0;
  const successes: Array<PhotoFilterState | null> = [];
  const errors: string[] = [];
  const saver = createFilterSaveController({
    save: (state, signal) => new Promise((resolve) => {
      pending.set(++saveNo, { resolve, signal });
      void state;
    }),
    onSuccess: (state) => successes.push(state),
    onError: (error) => errors.push(error.message),
    setTimer: (run, delay) => {
      delays.push(delay);
      const id = ++nextTimer;
      timers.set(id, run);
      return id;
    },
    clearTimer: (id) => timers.delete(id as number),
  });
  const a = setBookFilter(null, { lutId: 'cloudy-cool', strength: 40 });
  const b = setBookFilter(null, { lutId: 'daily-soft', strength: 60 });
  saver.schedule(a);
  saver.schedule(b);
  assert.deepEqual(delays, [180, 180]);
  assert.equal(timers.size, 1);
  timers.values().next().value?.();
  saver.schedule(a);
  assert.equal(pending.get(1)?.signal.aborted, true);
  pending.get(1)?.resolve(b);
  await Promise.resolve();
  assert.deepEqual(successes, []);
  timers.values().next().value?.();
  saver.dispose();
  pending.get(2)?.resolve(a);
  await Promise.resolve();
  assert.deepEqual(successes, []);
  assert.deepEqual(errors, []);
});

test('frozen backup plan keeps multi-photo versions and blob filter state paired across UI changes', async () => {
  let live: PhotoFilterState | null = setBookFilter(
    null,
    { lutId: 'cloudy-cool', strength: 80 },
  );
  const plan = createFrozenBackupPlan(['p1', 'p2'], live, {});
  const seen: Array<PhotoFilterState | null> = [];
  const prepared = await prepareSnapshotBlobs(plan, async (entry, frozen) => {
    seen.push(frozen);
    if (entry.photoId === 'p1') {
      live = setBookFilter(live, { lutId: 'daily-soft', strength: 40 });
    }
    return {
      blob: new Blob([entry.renderVersion]),
      filteredFallback: false,
    };
  });
  assert.equal(Object.isFrozen(plan.photoFilter), true);
  assert.equal(seen.every((state) => state === plan.photoFilter), true);
  assert.deepEqual(
    prepared.ready.map(({ entry }) => entry.renderVersion),
    ['pf-v1__cloudy-cool__80', 'pf-v1__cloudy-cool__80'],
  );
  assert.deepEqual(
    await Promise.all(prepared.ready.map(({ blob }) => blob.text())),
    ['pf-v1__cloudy-cool__80', 'pf-v1__cloudy-cool__80'],
  );
});

test('signed upload correlation rejects mismatches before upload and partial PUT confirms exact successes', async () => {
  const entries = collectSnapshotEntries(
    ['p1', 'p2'],
    setBookFilter(null, { lutId: 'cloudy-cool', strength: 80 }),
  );
  const signed = entries.map((entry) => ({
    ...entry,
    putUrl: `put:${entry.photoId}`,
    r2Key: `key:${entry.photoId}`,
    publicUrl: `public:${entry.photoId}`,
  }));
  assert.throws(
    () => correlateSignedSnapshotUploads(entries, [signed[0]!, { ...signed[0]! }]),
    /duplicate|missing/i,
  );
  assert.throws(
    () => correlateSignedSnapshotUploads(entries, [{ ...signed[0]!, renderVersion: 'pf-v1__original' }, signed[1]!]),
    /unexpected|missing|mismatch/i,
  );

  const correlated = correlateSignedSnapshotUploads(entries, signed);
  const uploaded = await uploadCorrelatedSnapshots(
    correlated.map((item) => ({ ...item, blob: new Blob([item.entry.renderVersion]) })),
    async (putUrl) => {
      if (putUrl === 'put:p2') throw new Error('PUT failed');
    },
  );
  assert.deepEqual(uploaded, [entries[0]]);
});
