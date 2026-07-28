import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  confirmPhotoSnapshot,
  signPhotoSnapshotUpload,
} from './photo-snapshot-client';

test('snapshot client sends SnapshotEntry arrays and preserves version correlation in outputs', async (t) => {
  const entries = [
    { photoId: 'photo-1', renderVersion: 'pf-v1__fuji-portrait__80' },
  ];
  const signed = [{
    ...entries[0]!,
    putUrl: 'https://put.test/photo-1',
    r2Key: 'photo-snapshots/u/a/photo-1/pf-v1__fuji-portrait__80.jpg',
    publicUrl: 'https://cdn.test/photo-1/pf-v1__fuji-portrait__80.jpg',
  }];
  const requests: { url: string; body: unknown }[] = [];
  t.mock.method(globalThis, 'fetch', (async (input: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as unknown;
    requests.push({ url: String(input), body });
    const data = String(input).endsWith('photo-snapshot-upload-url')
      ? signed
      : { photoIds: ['photo-1'], renderVersions: { 'photo-1': entries[0]!.renderVersion } };
    return new Response(JSON.stringify({ ok: true, data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch);

  assert.deepEqual(await signPhotoSnapshotUpload('album-1', entries), signed);
  assert.deepEqual(await confirmPhotoSnapshot('album-1', entries), {
    photoIds: ['photo-1'],
    renderVersions: { 'photo-1': 'pf-v1__fuji-portrait__80' },
  });
  assert.deepEqual(requests.map(({ body }) => body), [{ entries }, { entries }]);
});
