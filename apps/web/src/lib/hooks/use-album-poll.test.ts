import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as albumPoll from './use-album-poll';

const source = readFileSync(new URL('./use-album-poll.ts', import.meta.url), 'utf8');

test('live album signature changes when cloud photo snapshots arrive', () => {
  const signature = (
    albumPoll as unknown as {
      albumLiveSignature?: (state: albumPoll.AlbumPollState) => string;
    }
  ).albumLiveSignature;

  assert.equal(
    typeof signature,
    'function',
    'useAlbumPoll must expose the signature used to deduplicate live detail updates',
  );
  if (!signature) return;

  const base: albumPoll.AlbumPollState = {
    phase: 'ready',
    generation: null,
    error: null,
    detail: {
      album: {
        id: 'album-1',
        title: 'Book',
        status: 'EDITING',
        stage: 'ready',
        prompt: '',
        layoutJson: null,
        photoCount: 1,
        pageCount: 1,
        pdfUrl: null,
        photoSnapshotUrls: {},
        photoSnapshotRenderVersions: {},
        errorMessage: null,
        createdAt: '2026-07-29T00:00:00.000Z',
      },
      pages: [],
    },
  };
  const withCloudPhoto: albumPoll.AlbumPollState = {
    ...base,
    detail: {
      ...base.detail!,
      album: {
        ...base.detail!.album,
        photoSnapshotUrls: {
          'photo-1':
            'https://cdn.yujeeai.com/photo-snapshots/user/album-1/photo-1/pf-v1__none.jpg',
        },
        photoSnapshotRenderVersions: { 'photo-1': 'pf-v1__none' },
      },
    },
  };

  assert.notEqual(
    signature(base),
    signature(withCloudPhoto),
    'a mobile client without IndexedDB originals must receive the new cloud URL',
  );
});

test('album polling bypasses the browser cache so mobile sees new cloud photos', () => {
  assert.match(
    source,
    /fetch\(`\/api\/v1\/albums\/\$\{uuid\}`,\s*\{\s*cache:\s*'no-store'\s*\}\)/,
  );
});
