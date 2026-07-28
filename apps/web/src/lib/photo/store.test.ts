import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoFilterState } from './filter-state';
import { lutEngine } from './lut/engine';

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

function makeFailedReq(error: Error): FakeRequest {
  const req: FakeRequest = { result: undefined, error, onsuccess: null, onerror: null };
  queueMicrotask(() => req.onerror?.());
  return req;
}

interface FakeIndexedDb {
  originals: Map<string, unknown>;
  derived: Map<string, unknown>;
  derivedPutFailure: ((key: string) => boolean) | null;
  derivedDeleteFailure: ((key: string) => boolean) | null;
  derivedKeyOrder: ((keys: string[]) => string[]) | null;
  deletedDerivedKeys: string[];
}

function installFakeIndexedDb(): FakeIndexedDb {
  const fake: FakeIndexedDb = {
    originals: new Map(),
    derived: new Map(),
    derivedPutFailure: null,
    derivedDeleteFailure: null,
    derivedKeyOrder: null,
    deletedDerivedKeys: [],
  };
  const objectStore = (storeName: string) => {
    const data = storeName === 'derived' ? fake.derived : fake.originals;
    return {
      put: (value: unknown, key: string) => {
        if (storeName === 'derived' && fake.derivedPutFailure?.(key)) {
          return makeFailedReq(new Error(`injected derived put failure: ${key}`));
        }
        data.set(key, value);
        return makeReq(undefined);
      },
      get: (key: string) => makeReq(data.get(key)),
      delete: (key: string) => {
        if (storeName === 'derived') fake.deletedDerivedKeys.push(key);
        if (storeName === 'derived' && fake.derivedDeleteFailure?.(key)) {
          return makeFailedReq(new Error(`injected derived delete failure: ${key}`));
        }
        data.delete(key);
        return makeReq(undefined);
      },
      getAllKeys: () => {
        const keys = [...data.keys()];
        return makeReq(storeName === 'derived' && fake.derivedKeyOrder
          ? fake.derivedKeyOrder(keys)
          : keys);
      },
    };
  };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: (storeName: string) => ({ objectStore: () => objectStore(storeName) }),
  };
  (globalThis as Record<string, unknown>).indexedDB = {
    open: () => {
      const req = makeReq(db);
      req.onupgradeneeded = null;
      return req;
    },
  };
  return fake;
}

const fakeDb = installFakeIndexedDb();
const stored = fakeDb.originals;
// store.ts 模块级缓存 dbPromise,必须先装假 indexedDB 再 import。
const {
  derivedCacheKey,
  filteredVariantPrefix,
  photoStore,
} = await import('./store');

function filterState(
  lutId: 'cloudy-cool' | 'street-negative',
  strength: number,
  overrides?: PhotoFilterState['overrides'],
): PhotoFilterState {
  return { default: { lutId, strength }, ...(overrides && { overrides }) };
}

async function withFakeLut<T>(
  apply: typeof lutEngine.applyToBlob,
  run: () => Promise<T>,
): Promise<T> {
  const original = lutEngine.applyToBlob;
  lutEngine.applyToBlob = apply;
  try {
    return await run();
  } finally {
    lutEngine.applyToBlob = original;
  }
}

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

test('derived cache keys preserve legacy no-filter keys and version quantized filters', () => {
  assert.equal(derivedCacheKey('p1', 'display', null), 'p1@display');
  assert.equal(
    derivedCacheKey('p1', 'display', { lutId: 'cloudy-cool', strength: 80 }),
    'p1@display@pf-v1@cloudy-cool@80',
  );
  assert.equal(
    derivedCacheKey('p1', 'display', { lutId: 'cloudy-cool', strength: 2 }),
    'p1@display',
  );
  assert.equal(filteredVariantPrefix('p1', 'display'), 'p1@display@pf-v1@');
});

test('getTierBlob resolves explicit-null overrides and shared strength quantization', async () => {
  const base = new Blob(['base'], { type: 'image/jpeg' });
  fakeDb.derived.set('resolve@display', base);
  const refs: unknown[] = [];

  await withFakeLut(async (_blob, ref, tier) => {
    refs.push({ ref, tier });
    return new Blob(['filtered'], { type: 'image/jpeg' });
  }, async () => {
    const state = filterState('cloudy-cool', 52, { resolve: null });
    assert.equal(await photoStore.getTierBlob('resolve', 'display', state), base);
    await photoStore.getTierBlob(
      'resolve',
      'display',
      filterState('cloudy-cool', 52),
    );
  });

  assert.deepEqual(refs, [{
    ref: { lutId: 'cloudy-cool', strength: 50 },
    tier: 'full',
  }]);
});

test('filtered variants persist only the two most recently used keys, independent of key order', async () => {
  const photoId = 'lru';
  const baseKey = `${photoId}@display`;
  fakeDb.derived.set(baseKey, new Blob(['base'], { type: 'image/jpeg' }));
  fakeDb.derivedKeyOrder = (keys) => [...keys].reverse();

  await withFakeLut(async (_blob, ref) => (
    new Blob([`${ref.strength}`], { type: 'image/jpeg' })
  ), async () => {
    await photoStore.getTierBlob(photoId, 'display', filterState('cloudy-cool', 20));
    await photoStore.getTierBlob(photoId, 'display', filterState('cloudy-cool', 80));
    // Re-access 20 after both values are persisted. Durable recency, not the
    // lexicographic/IDB key order, must make 80 the next eviction victim.
    await photoStore.getTierBlob(photoId, 'display', filterState('cloudy-cool', 20));
    await photoStore.getTierBlob(photoId, 'display', filterState('cloudy-cool', 60));
  });

  const key = (strength: number) => derivedCacheKey(
    photoId,
    'display',
    { lutId: 'cloudy-cool', strength },
  );
  assert.equal(fakeDb.derived.has(key(20)), true);
  assert.equal(fakeDb.derived.has(key(60)), true);
  assert.equal(fakeDb.derived.has(key(80)), false);
  assert.equal(fakeDb.derived.has(baseKey), true, 'base derived bytes are never evicted');
  fakeDb.derivedKeyOrder = null;
});

test('a failed filtered render returns the exact base and is not persisted as a variant', async () => {
  const photoId = 'render-failure';
  const base = new Blob(['base'], { type: 'image/jpeg' });
  fakeDb.derived.set(`${photoId}@thumb`, base);
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    const result = await withFakeLut(async (blob) => blob, () =>
      photoStore.getTierBlob(photoId, 'thumb', filterState('street-negative', 75)));
    assert.equal(result, base);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(
    fakeDb.derived.has(derivedCacheKey(
      photoId,
      'thumb',
      { lutId: 'street-negative', strength: 75 },
    )),
    false,
  );
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0]?.[0]), /not cached/i);
});

test('filtered variant write and eviction failures are nonfatal and stay within photo+tier prefix', async () => {
  const photoId = 'failure-safety';
  const baseKey = `${photoId}@display`;
  const otherBaseKey = 'other@display';
  const otherTierKey = `${photoId}@thumb@pf-v1@cloudy-cool@10`;
  const base = new Blob(['base'], { type: 'image/jpeg' });
  fakeDb.derived.set(baseKey, base);
  fakeDb.derived.set(otherBaseKey, new Blob(['other'], { type: 'image/jpeg' }));
  fakeDb.derived.set(otherTierKey, new Blob(['other-tier'], { type: 'image/jpeg' }));
  const failingKey = derivedCacheKey(
    photoId,
    'display',
    { lutId: 'cloudy-cool', strength: 45 },
  );
  fakeDb.derivedPutFailure = (key) => key === failingKey;

  const rendered = new Blob(['rendered'], { type: 'image/jpeg' });
  const result = await withFakeLut(async () => rendered, () =>
    photoStore.getTierBlob(photoId, 'display', filterState('cloudy-cool', 45)));

  assert.equal(result, rendered);
  assert.equal(fakeDb.derived.has(failingKey), false);
  assert.equal(fakeDb.derived.has(baseKey), true);
  assert.equal(fakeDb.derived.has(otherBaseKey), true);
  assert.equal(fakeDb.derived.has(otherTierKey), true);
  assert.equal(fakeDb.deletedDerivedKeys.includes(baseKey), false);
  assert.equal(fakeDb.deletedDerivedKeys.includes(otherBaseKey), false);
  assert.equal(fakeDb.deletedDerivedKeys.includes(otherTierKey), false);
  fakeDb.derivedPutFailure = null;

  const evictionPhotoId = 'eviction-failure';
  const evictionBaseKey = `${evictionPhotoId}@display`;
  fakeDb.derived.set(evictionBaseKey, new Blob(['base'], { type: 'image/jpeg' }));
  await withFakeLut(async (_blob, ref) => (
    new Blob([`${ref.strength}`], { type: 'image/jpeg' })
  ), async () => {
    await photoStore.getTierBlob(
      evictionPhotoId,
      'display',
      filterState('cloudy-cool', 10),
    );
    await photoStore.getTierBlob(
      evictionPhotoId,
      'display',
      filterState('cloudy-cool', 20),
    );
    const oldestKey = derivedCacheKey(
      evictionPhotoId,
      'display',
      { lutId: 'cloudy-cool', strength: 10 },
    );
    fakeDb.derivedDeleteFailure = (key) => key === oldestKey;
    const newest = await photoStore.getTierBlob(
      evictionPhotoId,
      'display',
      filterState('cloudy-cool', 30),
    );
    assert.equal(await newest?.text(), '30');
  });
  assert.equal(fakeDb.derived.has(evictionBaseKey), true);
  assert.equal(fakeDb.derived.has(otherBaseKey), true);
  assert.equal(fakeDb.derived.has(otherTierKey), true);
  fakeDb.derivedDeleteFailure = null;
});

// ── 屏显派生分级(P0 性能):getTierUrl(s) ─────────────────────────────────────
// node 测试环境没有 canvas/Image,派生降采样必然失败 —— 契约是"任何失败回退
// 原图 URL,绝不白屏"。这里锁的就是这个回退路径 + URL 结果的缓存复用。

test('getTierUrl falls back to the original object URL when derivation is impossible', async () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'tier.jpg', { type: 'image/jpeg' });
  await photoStore.put('t1', file);

  const url = await photoStore.getTierUrl('t1', 'display');
  assert.ok(url, 'fallback must still yield a usable URL');
  assert.match(url!, /^blob:/);

  // 同一 photoId 再取(经 getObjectUrl 的原图缓存)不再新建 URL。
  const again = await photoStore.getTierUrl('t1', 'display');
  assert.equal(again, url);
});

test('getTierUrls returns a map and skips unknown photoIds', async () => {
  const file = new File([new Uint8Array([4])], 'tier2.jpg', { type: 'image/jpeg' });
  await photoStore.put('t2', file);

  const map = await photoStore.getTierUrls(['t2', 'missing-id'], 'thumb');
  assert.ok(map['t2']);
  assert.equal(map['missing-id'], undefined);
});

test('getTierUrl versions URL cache by effective filter and retries exact-base LUT fallbacks', async () => {
  const photoId = 'url-version';
  const base = new Blob(['base'], { type: 'image/jpeg' });
  fakeDb.derived.set(`${photoId}@display`, base);
  let calls = 0;
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    await withFakeLut(async (blob, ref) => {
      calls += 1;
      if (ref.strength === 20) return new Blob(['20'], { type: 'image/jpeg' });
      return blob;
    }, async () => {
      const first = await photoStore.getTierUrl(
        photoId,
        'display',
        filterState('cloudy-cool', 20),
      );
      const failed = await photoStore.getTierUrl(
        photoId,
        'display',
        filterState('cloudy-cool', 40),
      );
      const failedAgain = await photoStore.getTierUrl(
        photoId,
        'display',
        filterState('cloudy-cool', 40),
      );
      const firstAgain = await photoStore.getTierUrl(
        photoId,
        'display',
        filterState('cloudy-cool', 20),
      );

      assert.ok(first);
      assert.ok(failed);
      assert.equal(failedAgain, failed, 'base-tier URL can be reused without marking the filter cached');
      assert.equal(firstAgain, first, 'successful filtered URL is cached by versioned key');
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(calls, 3, 'failed filtered versions retry while successful versions reuse URL cache');
});

test('getTierUrls forwards one filter state while retaining the four-worker bound', async () => {
  const store = Object.create(photoStore) as typeof photoStore;
  let active = 0;
  let maxActive = 0;
  const seenStates: Array<PhotoFilterState | null | undefined> = [];
  const state = filterState('cloudy-cool', 55);
  store.getTierUrl = async (_id, _tier, photoFilter) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    seenStates.push(photoFilter);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return 'blob:test';
  };

  await store.getTierUrls(
    Array.from({ length: 12 }, (_, index) => `worker-${index}`),
    'thumb',
    state,
  );

  assert.equal(maxActive, 4);
  assert.equal(seenStates.length, 12);
  assert.equal(seenStates.every((seen) => seen === state), true);
});
