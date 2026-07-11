import assert from 'node:assert/strict';
import test from 'node:test';

// Safari/WebKit 已知坑:把 <input> 选出的 file-backed File/Blob 直接 put 进
// IndexedDB,提交阶段回读源文件可能抛 UnknownError("Error preparing Blob/File
// data to be stored in object store"),iOS 照片库的临时副本尤其容易踩。
// 契约:photoStore.put/putMany 必须先把字节读进内存、存一个 memory-backed 副本,
// 并保留 name/type(读回后 HEIC 识别依赖它们,见 heic.ts 的 isHeicOrHeif)。

type FakeRequest = {
  result: unknown;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded?: (() => void) | null;
};

function makeReq(result: unknown): FakeRequest {
  const req: FakeRequest = { result, error: null, onsuccess: null, onerror: null };
  queueMicrotask(() => req.onsuccess?.());
  return req;
}

function installFakeIndexedDb(): Map<string, unknown> {
  const data = new Map<string, unknown>();
  const objectStore = {
    put: (value: unknown, key: string) => {
      data.set(key, value);
      return makeReq(undefined);
    },
    get: (key: string) => makeReq(data.get(key)),
  };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({ objectStore: () => objectStore }),
  };
  (globalThis as Record<string, unknown>).indexedDB = {
    open: () => {
      const req = makeReq(db);
      req.onupgradeneeded = null;
      return req;
    },
  };
  return data;
}

const stored = installFakeIndexedDb();
// store.ts 模块级缓存 dbPromise,必须先装假 indexedDB 再 import。
const { photoStore } = await import('./store');

test('put stores a memory-backed copy, never the original file-backed File', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const file = new File([bytes], 'IMG_0001.HEIC', { type: '' });

  await photoStore.put('p1', file);

  const value = stored.get('p1');
  assert.ok(value instanceof Blob, 'stored value is a Blob');
  assert.notEqual(value, file, 'must not store the original File object reference');
  assert.equal((value as File).name, 'IMG_0001.HEIC', 'name preserved for HEIC sniffing');
  assert.deepEqual(new Uint8Array(await (value as Blob).arrayBuffer()), bytes);
});

test('put preserves the MIME type on the stored copy', async () => {
  const file = new File([new Uint8Array([9, 9])], 'a.jpg', { type: 'image/jpeg' });
  await photoStore.put('p2', file);
  assert.equal((stored.get('p2') as Blob).type, 'image/jpeg');
});

test('put keeps plain nameless Blobs storable', async () => {
  const blob = new Blob([new Uint8Array([7])], { type: 'image/heic' });
  await photoStore.put('p3', blob);
  const value = stored.get('p3') as Blob;
  assert.notEqual(value, blob);
  assert.equal(value.type, 'image/heic');
  assert.deepEqual(new Uint8Array(await value.arrayBuffer()), new Uint8Array([7]));
});

test('putMany stores memory-backed copies for every item', async () => {
  const f1 = new File([new Uint8Array([1])], 'x.heic', { type: '' });
  const f2 = new File([new Uint8Array([2])], 'y.jpg', { type: 'image/jpeg' });

  await photoStore.putMany([
    { photoId: 'm1', blob: f1 },
    { photoId: 'm2', blob: f2 },
  ]);

  assert.notEqual(stored.get('m1'), f1);
  assert.notEqual(stored.get('m2'), f2);
  assert.equal((stored.get('m1') as File).name, 'x.heic');
  assert.deepEqual(new Uint8Array(await (stored.get('m2') as Blob).arrayBuffer()), new Uint8Array([2]));
});
