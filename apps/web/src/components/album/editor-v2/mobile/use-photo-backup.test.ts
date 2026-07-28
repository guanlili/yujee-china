import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { PhotoFilterState } from '@/lib/photo/filter-state';
import type {
  SignedSnapshotUpload,
  SnapshotEntry,
} from '@/lib/album/photo-snapshot-client';

const here = dirname(fileURLToPath(import.meta.url));

type BackupDeps = {
  getTierBlobStatus: (
    photoId: string,
    state: PhotoFilterState | null,
  ) => Promise<{ blob: Blob | undefined; filteredFallback: boolean }>;
  sign: (entries: SnapshotEntry[]) => Promise<SignedSnapshotUpload[]>;
  put: (url: string, blob: Blob) => Promise<void>;
  confirm: (entries: SnapshotEntry[]) => Promise<unknown>;
};

async function runner() {
  const module = await import('./use-photo-backup');
  assert.equal(
    typeof module.runPhotoBackup,
    'function',
    'use-photo-backup must expose the production backup runner',
  );
  return module.runPhotoBackup;
}

function signed(entries: readonly SnapshotEntry[]): SignedSnapshotUpload[] {
  return entries.map((entry) => ({
    ...entry,
    putUrl: `put:${entry.photoId}:${entry.renderVersion}`,
    r2Key: `key:${entry.photoId}`,
    publicUrl: `public:${entry.photoId}`,
  }));
}

test('backup freezes normalized filter state and uploads only version mismatches', async () => {
  const runPhotoBackup = await runner();
  let live: PhotoFilterState = {
    default: { lutId: 'cloudy-cool', strength: 78 },
  };
  const seen: Array<PhotoFilterState | null> = [];
  const signedEntries: SnapshotEntry[][] = [];
  const confirmed: SnapshotEntry[][] = [];
  const deps: BackupDeps = {
    getTierBlobStatus: async (photoId, state) => {
      seen.push(state);
      live = { default: { lutId: 'daily-soft', strength: 40 } };
      return { blob: new Blob([photoId]), filteredFallback: false };
    },
    sign: async (entries) => {
      signedEntries.push(entries);
      return signed(entries);
    },
    put: async () => undefined,
    confirm: async (entries) => {
      confirmed.push(entries);
    },
  };

  const result = await runPhotoBackup({
    albumId: 'album',
    photoIds: ['same', 'todo', 'todo'],
    photoFilter: live,
    currentVersions: { same: 'pf-v1__cloudy-cool__80' },
    deps,
  });

  assert.deepEqual(signedEntries, [[
    { photoId: 'todo', renderVersion: 'pf-v1__cloudy-cool__80' },
  ]]);
  assert.deepEqual(confirmed, signedEntries);
  assert.equal(seen.length, 1);
  assert.equal(Object.isFrozen(seen[0]), true);
  assert.equal(seen[0]?.default?.strength, 80);
  assert.equal(result.missing, 0);
  assert.equal(result.uploaded, 1);
  assert.deepEqual(result.renderVersions, {
    same: 'pf-v1__cloudy-cool__80',
    todo: 'pf-v1__cloudy-cool__80',
  });
  assert.equal(live.default?.lutId, 'daily-soft');
});

test('backup refuses missing local and filtered-fallback bytes', async () => {
  const runPhotoBackup = await runner();
  let signs = 0;
  const result = await runPhotoBackup({
    albumId: 'album',
    photoIds: ['missing', 'fallback'],
    photoFilter: { default: { lutId: 'cloudy-cool', strength: 80 } },
    currentVersions: {},
    deps: {
      getTierBlobStatus: async (photoId) => ({
        blob: photoId === 'missing' ? undefined : new Blob(['base']),
        filteredFallback: photoId === 'fallback',
      }),
      sign: async () => {
        signs += 1;
        return [];
      },
      put: async () => undefined,
      confirm: async () => undefined,
    },
  });

  assert.equal(signs, 0);
  assert.equal(result.missing, 2);
  assert.equal(result.uploaded, 0);
  assert.deepEqual(result.renderVersions, {});
});

test('backup rejects signed version mismatch before PUT', async () => {
  const runPhotoBackup = await runner();
  let puts = 0;
  await assert.rejects(
    runPhotoBackup({
      albumId: 'album',
      photoIds: ['p1'],
      photoFilter: { default: { lutId: 'cloudy-cool', strength: 80 } },
      currentVersions: {},
      deps: {
        getTierBlobStatus: async () => ({
          blob: new Blob(['filtered']),
          filteredFallback: false,
        }),
        sign: async (entries) => signed(entries).map((entry) => ({
          ...entry,
          renderVersion: 'pf-v1__original',
        })),
        put: async () => {
          puts += 1;
        },
        confirm: async () => undefined,
      },
    }),
    /mismatch|unexpected|missing/i,
  );
  assert.equal(puts, 0);
});

test('backup confirms only successful entries and returned versions make repeat a no-op', async () => {
  const runPhotoBackup = await runner();
  const confirmations: SnapshotEntry[][] = [];
  let signs = 0;
  const deps: BackupDeps = {
    getTierBlobStatus: async (photoId) => ({
      blob: new Blob([photoId]),
      filteredFallback: false,
    }),
    sign: async (entries) => {
      signs += 1;
      return signed(entries);
    },
    put: async (url) => {
      if (url.includes('p2')) throw new Error('partial PUT failure');
    },
    confirm: async (entries) => {
      confirmations.push(entries);
    },
  };
  const photoFilter: PhotoFilterState = {
    default: { lutId: 'fuji-portrait', strength: 60 },
  };
  const partial = await runPhotoBackup({
    albumId: 'album',
    photoIds: ['p1', 'p2'],
    photoFilter,
    currentVersions: {},
    deps,
  });

  assert.deepEqual(confirmations, [[
    { photoId: 'p1', renderVersion: 'pf-v1__fuji-portrait__60' },
  ]]);
  assert.equal(partial.missing, 1);
  assert.equal(partial.uploaded, 1);

  const completed = await runPhotoBackup({
    albumId: 'album',
    photoIds: ['p1'],
    photoFilter,
    currentVersions: partial.renderVersions,
    deps,
  });
  assert.equal(signs, 1, 'exact repeated version must not sign or upload again');
  assert.equal(completed.missing, 0);
  assert.equal(completed.uploaded, 0);
});

test('mobile backup uses shared strict helpers and SnapshotEntry-only client APIs', () => {
  const hook = readFileSync(join(here, 'use-photo-backup.ts'), 'utf8');
  assert.match(hook, /createFrozenBackupPlan/);
  assert.match(hook, /prepareSnapshotBlobs/);
  assert.match(hook, /correlateSignedSnapshotUploads/);
  assert.match(hook, /uploadCorrelatedSnapshots/);
  assert.match(hook, /getTierBlobStatus/);

  const client = readFileSync(
    join(here, '..', '..', '..', '..', 'lib', 'album', 'photo-snapshot-client.ts'),
    'utf8',
  );
  assert.doesNotMatch(client, /normalizeSnapshotEntries/);
  assert.doesNotMatch(client, /SnapshotEntry\[\]\s*\|\s*string\[\]/);
  assert.doesNotMatch(client, /entriesOrLegacyPhotoIds/);
  assert.doesNotMatch(client, /@deprecated/);
});
