import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  planPhotoOriginalSync,
  runPhotoOriginalSync,
  type PhotoOriginalSyncDeps,
} from './photo-original-sync';
import type {
  PhotoOriginalUploadEntry,
  SignedPhotoOriginalUpload,
} from './photo-original-client';

function fakeBlob(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)]);
}

test('planPhotoOriginalSync: 差集与去重(uploaded 的排除, missing 的不排除)', () => {
  const bookPhotoIds = ['p1', 'p2', 'p1', 'p3', 'p2', 'p4'];
  // p2 已在服务端确认上传;p4 服务端记为 missing(不在 serverUploaded 里) —— 两者
  // 都应保留重试资格,只有 p2 应被排除。
  const serverUploaded = new Set(['p2']);
  assert.deepEqual(planPhotoOriginalSync(bookPhotoIds, serverUploaded), ['p1', 'p3', 'p4']);
});

test('planPhotoOriginalSync: 空输入与全量已上传', () => {
  assert.deepEqual(planPhotoOriginalSync([], new Set()), []);
  assert.deepEqual(planPhotoOriginalSync(['a', 'b'], new Set(['a', 'b'])), []);
});

test('runPhotoOriginalSync: 3 张本地有、1 张本地无 —— 调用次数/payload/结果/进度', async () => {
  const localBlobs: Record<string, { blob: Blob; width: number; height: number }> = {
    p1: { blob: fakeBlob(10), width: 100, height: 200 },
    p2: { blob: fakeBlob(20), width: 150, height: 250 },
    p3: { blob: fakeBlob(30), width: 300, height: 300 },
  };

  const signCalls: { albumId: string; entries: PhotoOriginalUploadEntry[] }[] = [];
  const putCalls: { putUrl: string; blob: Blob }[] = [];
  const confirmCalls: { albumId: string; input: { entries?: PhotoOriginalUploadEntry[]; missing?: string[] } }[] = [];

  const deps: PhotoOriginalSyncDeps = {
    getCanonicalUploadBlob: async (photoId) => localBlobs[photoId],
    sign: async (albumId, entries) => {
      signCalls.push({ albumId, entries });
      return entries.map((e): SignedPhotoOriginalUpload => ({
        photoId: e.photoId,
        putUrl: `https://put.test/${e.photoId}`,
        r2Key: `photo-originals/${albumId}/${e.photoId}.jpg`,
      }));
    },
    put: async (putUrl, blob) => {
      putCalls.push({ putUrl, blob });
    },
    confirm: async (albumId, input) => {
      confirmCalls.push({ albumId, input });
      return { uploaded: input.entries?.length ?? 0, missing: input.missing?.length ?? 0 };
    },
  };

  const progressLog: { done: number; total: number }[] = [];
  const result = await runPhotoOriginalSync({
    albumId: 'album-1',
    photoIds: ['p1', 'p2', 'p3', 'p4'],
    serverUploaded: new Set(),
    deps,
    onProgress: (done, total) => progressLog.push({ done, total }),
  });

  assert.deepEqual(result, { uploaded: 3, missingLocal: 1 });

  // sign: 一批,只含本地存在的 3 张,payload 是 {photoId,width,height,bytes}。
  assert.equal(signCalls.length, 1);
  assert.deepEqual(
    signCalls[0]!.entries.map((e) => e.photoId).sort(),
    ['p1', 'p2', 'p3'],
  );
  for (const e of signCalls[0]!.entries) {
    const local = localBlobs[e.photoId]!;
    assert.equal(e.width, local.width);
    assert.equal(e.height, local.height);
    assert.equal(e.bytes, local.blob.size);
  }

  // put: 逐张,3 次,url 与 blob 对应签名结果。
  assert.equal(putCalls.length, 3);
  for (const call of putCalls) {
    assert.ok(call.putUrl.startsWith('https://put.test/'));
  }

  // confirm: 一次 {entries: 3 张} + 一次 {missing: ['p4']}。
  assert.equal(confirmCalls.length, 2);
  const entriesConfirm = confirmCalls.find((c) => c.input.entries);
  const missingConfirm = confirmCalls.find((c) => c.input.missing);
  assert.ok(entriesConfirm);
  assert.equal(entriesConfirm!.input.entries!.length, 3);
  assert.deepEqual(missingConfirm!.input.missing, ['p4']);

  // onProgress: 单调递增,终值到 total(=4)。
  assert.ok(progressLog.length > 0);
  assert.equal(progressLog[progressLog.length - 1]!.total, 4);
  assert.equal(progressLog[progressLog.length - 1]!.done, 4);
  for (let i = 1; i < progressLog.length; i++) {
    assert.ok(progressLog[i]!.done >= progressLog[i - 1]!.done);
  }
});

test('runPhotoOriginalSync: 一张 PUT 抛错 —— 不进 confirm entries,其余照常,函数不抛', async () => {
  const localBlobs: Record<string, { blob: Blob; width: number; height: number }> = {
    p1: { blob: fakeBlob(10), width: 100, height: 200 },
    p2: { blob: fakeBlob(20), width: 150, height: 250 },
    p3: { blob: fakeBlob(30), width: 300, height: 300 },
  };

  const confirmCalls: { albumId: string; input: { entries?: PhotoOriginalUploadEntry[]; missing?: string[] } }[] = [];

  const deps: PhotoOriginalSyncDeps = {
    getCanonicalUploadBlob: async (photoId) => localBlobs[photoId],
    sign: async (_albumId, entries) =>
      entries.map((e): SignedPhotoOriginalUpload => ({
        photoId: e.photoId,
        putUrl: `https://put.test/${e.photoId}`,
        r2Key: `photo-originals/${e.photoId}.jpg`,
      })),
    put: async (putUrl) => {
      if (putUrl.endsWith('/p2')) throw new Error('simulated PUT failure');
    },
    confirm: async (albumId, input) => {
      confirmCalls.push({ albumId, input });
      return { uploaded: input.entries?.length ?? 0, missing: input.missing?.length ?? 0 };
    },
  };

  const result = await runPhotoOriginalSync({
    albumId: 'album-1',
    photoIds: ['p1', 'p2', 'p3'],
    serverUploaded: new Set(),
    deps,
  });

  // p2 的 PUT 失败:不算 uploaded,计入 missingLocal;p1/p3 正常。函数本身不抛。
  assert.deepEqual(result, { uploaded: 2, missingLocal: 1 });

  const entriesConfirm = confirmCalls.find((c) => c.input.entries);
  const missingConfirm = confirmCalls.find((c) => c.input.missing);
  assert.ok(entriesConfirm);
  assert.deepEqual(
    entriesConfirm!.input.entries!.map((e) => e.photoId).sort(),
    ['p1', 'p3'],
  );
  assert.deepEqual(missingConfirm!.input.missing, ['p2']);
});

test('runPhotoOriginalSync: photoIds 全部已 uploaded —— 零网络调用', async () => {
  let calls = 0;
  const deps: PhotoOriginalSyncDeps = {
    getCanonicalUploadBlob: async () => {
      calls += 1;
      return undefined;
    },
    sign: async () => {
      calls += 1;
      return [];
    },
    put: async () => {
      calls += 1;
    },
    confirm: async () => {
      calls += 1;
      return { uploaded: 0, missing: 0 };
    },
  };

  const result = await runPhotoOriginalSync({
    albumId: 'album-1',
    photoIds: ['p1', 'p2'],
    serverUploaded: new Set(['p1', 'p2']),
    deps,
  });

  assert.deepEqual(result, { uploaded: 0, missingLocal: 0 });
  assert.equal(calls, 0);
});
