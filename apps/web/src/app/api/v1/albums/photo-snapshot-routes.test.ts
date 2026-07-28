import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as snapshotUtil from '@/services/album/photo-snapshot-util';

const here = dirname(fileURLToPath(import.meta.url));
const uploadRouteSource = readFileSync(
  join(here, '[uuid]', 'photo-snapshot-upload-url', 'route.ts'),
  'utf8',
);
const confirmRouteSource = readFileSync(
  join(here, '[uuid]', 'photo-snapshot', 'route.ts'),
  'utf8',
);

type BodySchema = {
  safeParse: (value: unknown) => { success: boolean; data?: unknown; error?: unknown };
};

const bodySchema = (
  snapshotUtil as typeof snapshotUtil & { SnapshotEntriesBodySchema?: BodySchema }
).SnapshotEntriesBodySchema;

test('both photo-snapshot routes use the shared entries-only request contract', () => {
  assert.equal(typeof bodySchema?.safeParse, 'function');
  assert.match(uploadRouteSource, /SnapshotEntriesBodySchema/);
  assert.match(confirmRouteSource, /SnapshotEntriesBodySchema/);
  assert.match(uploadRouteSource, /const\s+\{\s*entries\s*\}/);
  assert.match(confirmRouteSource, /const\s+\{\s*entries\s*\}/);

  const entries = [
    { photoId: 'photo-1', renderVersion: 'pf-v1__original' },
    { photoId: 'photo-2', renderVersion: 'pf-v1__fuji-portrait__80' },
  ];
  assert.deepEqual(bodySchema?.safeParse({ entries }), {
    success: true,
    data: { entries },
  });

  // Stored legacy rows stay compatible; legacy request bodies do not.
  assert.equal(bodySchema?.safeParse({ photoIds: ['photo-1'] }).success, false);
  assert.equal(bodySchema?.safeParse({ entries, photoIds: ['photo-1'] }).success, false);
});

test('route contract rejects duplicate/conflicting entries and malformed versions', () => {
  for (const entries of [
    [
      { photoId: 'photo-1', renderVersion: 'pf-v1__original' },
      { photoId: 'photo-1', renderVersion: 'pf-v1__original' },
    ],
    [
      { photoId: 'photo-1', renderVersion: 'pf-v1__original' },
      { photoId: 'photo-1', renderVersion: 'pf-v1__fuji-portrait__80' },
    ],
    [{ photoId: 'photo-1', renderVersion: '../evil' }],
    [{ photoId: 'photo-1', renderVersion: 'pf-v1__ok__80\ninjected' }],
  ]) {
    assert.equal(bodySchema?.safeParse({ entries }).success, false);
  }
});
