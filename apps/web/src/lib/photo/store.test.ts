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

type FakeDerivedOperation = 'get' | 'getAllKeys' | 'put' | 'delete';

interface FakeIndexedDb {
  originals: Map<string, unknown>;
  derived: Map<string, unknown>;
  derivedPutFailure: ((key: string, value: unknown) => boolean) | null;
  derivedDeleteFailure: ((key: string) => boolean) | null;
  derivedKeyOrder: ((keys: string[]) => string[]) | null;
  derivedRequestDelay:
    | ((operation: FakeDerivedOperation, key: string | undefined) => Promise<void> | void)
    | null;
  deletedDerivedKeys: string[];
}

function installFakeIndexedDb(): FakeIndexedDb {
  const fake: FakeIndexedDb = {
    originals: new Map(),
    derived: new Map(),
    derivedPutFailure: null,
    derivedDeleteFailure: null,
    derivedKeyOrder: null,
    derivedRequestDelay: null,
    deletedDerivedKeys: [],
  };

  interface QueuedOperation {
    request: FakeRequest;
    operation: FakeDerivedOperation;
    key: string | undefined;
    value?: unknown;
  }

  interface FakeTransaction {
    mode: IDBTransactionMode;
    storeName: string;
    error: Error | null;
    oncomplete: (() => void) | null;
    onabort: (() => void) | null;
    onerror: (() => void) | null;
    objectStore(): {
      put(value: unknown, key: string): FakeRequest;
      get(key: string): FakeRequest;
      delete(key: string): FakeRequest;
      getAllKeys(): FakeRequest;
    };
    abort(): void;
    start(): void;
  }

  const transactionQueue: FakeTransaction[] = [];
  let activeReaders = 0;
  let activeWriter = false;

  const scheduleTransactions = () => {
    if (activeWriter || activeReaders > 0 || transactionQueue.length === 0) return;
    if (transactionQueue[0].mode === 'readonly') {
      while (transactionQueue[0]?.mode === 'readonly') {
        const transaction = transactionQueue.shift()!;
        activeReaders += 1;
        transaction.start();
      }
      return;
    }
    activeWriter = true;
    transactionQueue.shift()!.start();
  };

  const createTransaction = (
    storeName: string,
    mode: IDBTransactionMode,
  ): FakeTransaction => {
    const source = storeName === 'derived' ? fake.derived : fake.originals;
    const operations: QueuedOperation[] = [];
    let working: Map<string, unknown>;
    let started = false;
    let settled = false;
    let pumping = false;

    const finish = (transaction: FakeTransaction, committed: boolean) => {
      if (settled) return;
      settled = true;
      if (committed && mode === 'readwrite') {
        source.clear();
        for (const [key, value] of working) source.set(key, value);
      }
      if (mode === 'readonly') activeReaders -= 1;
      else activeWriter = false;
      if (committed) transaction.oncomplete?.();
      else transaction.onabort?.();
      queueMicrotask(scheduleTransactions);
    };

    const transaction: FakeTransaction = {
      mode,
      storeName,
      error: null,
      oncomplete: null,
      onabort: null,
      onerror: null,
      objectStore: () => {
        const enqueue = (
          operation: FakeDerivedOperation,
          key: string | undefined,
          value?: unknown,
        ): FakeRequest => {
          const request: FakeRequest = {
            result: undefined,
            error: null,
            onsuccess: null,
            onerror: null,
          };
          operations.push({ request, operation, key, value });
          if (started) queueMicrotask(() => void pump());
          return request;
        };
        return {
          put: (value, key) => enqueue('put', key, value),
          get: (key) => enqueue('get', key),
          delete: (key) => enqueue('delete', key),
          getAllKeys: () => enqueue('getAllKeys', undefined),
        };
      },
      abort: () => {
        if (settled) return;
        transaction.error ??= new Error('fake IndexedDB transaction aborted');
        finish(transaction, false);
      },
      start: () => {
        if (settled) return;
        started = true;
        working = new Map(source);
        queueMicrotask(() => void pump());
      },
    };

    const pump = async (): Promise<void> => {
      if (!started || settled || pumping) return;
      const queued = operations.shift();
      if (!queued) {
        finish(transaction, true);
        return;
      }
      pumping = true;
      const { request, operation, key, value } = queued;
      try {
        if (storeName === 'derived') {
          await fake.derivedRequestDelay?.(operation, key);
        }
        if (
          storeName === 'derived'
          && operation === 'put'
          && fake.derivedPutFailure?.(key!, value)
        ) {
          throw new Error(`injected derived put failure: ${key}`);
        }
        if (
          storeName === 'derived'
          && operation === 'delete'
          && fake.derivedDeleteFailure?.(key!)
        ) {
          throw new Error(`injected derived delete failure: ${key}`);
        }

        if (operation === 'get') request.result = working.get(key!);
        if (operation === 'getAllKeys') {
          const keys = [...working.keys()];
          request.result = storeName === 'derived' && fake.derivedKeyOrder
            ? fake.derivedKeyOrder(keys)
            : keys;
        }
        if (operation === 'put') working.set(key!, value);
        if (operation === 'delete') {
          if (storeName === 'derived') fake.deletedDerivedKeys.push(key!);
          working.delete(key!);
        }
        request.onsuccess?.();
        pumping = false;
        if (operations.length === 0) finish(transaction, true);
        else queueMicrotask(() => void pump());
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        request.error = failure;
        transaction.error = failure;
        request.onerror?.();
        transaction.onerror?.();
        pumping = false;
        finish(transaction, false);
      }
    };

    transactionQueue.push(transaction);
    queueMicrotask(scheduleTransactions);
    return transaction;
  };

  const db = {
    objectStoreNames: { contains: () => true },
    transaction: (storeName: string, mode: IDBTransactionMode) =>
      createTransaction(storeName, mode),
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

test('filtered namespaces are injective for delimiter, percent, Unicode, and prefix-like photoIds', () => {
  const photoIds = [
    'p1',
    'p1@display@pf-v1@nested',
    '100%',
    '照片🌟',
    'p1@thumb@pf-recency-v1',
  ];
  const variants = photoIds.map((photoId) => ({
    photoId,
    prefix: filteredVariantPrefix(photoId, 'display'),
    key: derivedCacheKey(photoId, 'display', { lutId: 'cloudy-cool', strength: 50 }),
  }));

  assert.equal(variants[0]?.prefix, 'p1@display@pf-v1@');
  assert.equal(new Set(variants.map(({ prefix }) => prefix)).size, photoIds.length);
  for (const own of variants) {
    assert.equal(own.key.startsWith(own.prefix), true);
    for (const other of variants) {
      if (other === own) continue;
      assert.equal(
        other.key.startsWith(own.prefix),
        false,
        `${own.photoId} prefix must not capture ${other.photoId}`,
      );
    }
  }
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

test('filtered maintenance cannot match another adversarial photoId base, variant, or metadata', async () => {
  const photoId = 'scope';
  const adversarialId = 'scope@display@pf-v1@shadow%照片';
  fakeDb.derived.set(`${photoId}@display`, new Blob(['base-a'], { type: 'image/jpeg' }));
  fakeDb.derived.set(
    `${adversarialId}@display`,
    new Blob(['base-b'], { type: 'image/jpeg' }),
  );

  await withFakeLut(async (_blob, ref) => (
    new Blob([`${ref.strength}`], { type: 'image/jpeg' })
  ), async () => {
    await photoStore.getTierBlob(
      adversarialId,
      'display',
      filterState('street-negative', 55),
    );
    const protectedEntries = new Map(
      [...fakeDb.derived].filter(([key]) => key.includes('shadow%照片')),
    );

    await photoStore.getTierBlob(photoId, 'display', filterState('cloudy-cool', 10));
    await photoStore.getTierBlob(photoId, 'display', filterState('cloudy-cool', 20));
    await photoStore.getTierBlob(photoId, 'display', filterState('cloudy-cool', 30));

    assert.equal(fakeDb.derived.get(`${photoId}@display`) instanceof Blob, true);
    assert.equal(fakeDb.derived.get(`${adversarialId}@display`) instanceof Blob, true);
    for (const [key, value] of protectedEntries) {
      assert.equal(fakeDb.derived.get(key), value, `must preserve adversarial entry ${key}`);
    }
  });
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
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    const rendered = new Blob(['rendered'], { type: 'image/jpeg' });
    const beforePutFailure = new Map(fakeDb.derived);
    fakeDb.derivedPutFailure = (key) => key === failingKey;
    const result = await withFakeLut(async () => rendered, () =>
      photoStore.getTierBlob(photoId, 'display', filterState('cloudy-cool', 45)));

    assert.equal(result, rendered);
    assert.deepEqual(fakeDb.derived, beforePutFailure);
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
  } finally {
    fakeDb.derivedPutFailure = null;
    fakeDb.derivedDeleteFailure = null;
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 2);
});

test('filtered cache transaction rolls back variant, metadata, and deletes on metadata failure', async () => {
  const photoId = 'atomic-metadata';
  fakeDb.derived.set(`${photoId}@display`, new Blob(['base'], { type: 'image/jpeg' }));
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    await withFakeLut(async (_blob, ref) => (
      new Blob([`${ref.strength}`], { type: 'image/jpeg' })
    ), async () => {
      await photoStore.getTierBlob(photoId, 'display', filterState('cloudy-cool', 10));
      await photoStore.getTierBlob(photoId, 'display', filterState('cloudy-cool', 20));
      const metadataKey = [...fakeDb.derived].find(([key, value]) => (
        key.includes(photoId)
        && typeof value === 'object'
        && !(value instanceof Blob)
        && (value as { version?: unknown }).version === 1
      ))?.[0];
      assert.ok(metadataKey);
      const before = new Map(fakeDb.derived);
      fakeDb.derivedPutFailure = (key) => key === metadataKey;

      const rendered = await photoStore.getTierBlob(
        photoId,
        'display',
        filterState('cloudy-cool', 30),
      );

      assert.equal(await rendered?.text(), '30');
      assert.deepEqual(fakeDb.derived, before);
    });
  } finally {
    fakeDb.derivedPutFailure = null;
    console.warn = originalWarn;
  }
  assert.equal(warnings.some(([message]) => /cache.*transaction/i.test(String(message))), true);
});

test('filtered cache transaction rolls back all writes when an over-limit delete fails', async () => {
  const photoId = 'atomic-delete';
  fakeDb.derived.set(`${photoId}@display`, new Blob(['base'], { type: 'image/jpeg' }));
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    await withFakeLut(async (_blob, ref) => (
      new Blob([`${ref.strength}`], { type: 'image/jpeg' })
    ), async () => {
      await photoStore.getTierBlob(photoId, 'display', filterState('cloudy-cool', 10));
      await photoStore.getTierBlob(photoId, 'display', filterState('cloudy-cool', 20));
      const oldestKey = derivedCacheKey(
        photoId,
        'display',
        { lutId: 'cloudy-cool', strength: 10 },
      );
      const before = new Map(fakeDb.derived);
      fakeDb.derivedDeleteFailure = (key) => key === oldestKey;

      const rendered = await photoStore.getTierBlob(
        photoId,
        'display',
        filterState('cloudy-cool', 30),
      );

      assert.equal(await rendered?.text(), '30');
      assert.deepEqual(fakeDb.derived, before);
    });
  } finally {
    fakeDb.derivedDeleteFailure = null;
    console.warn = originalWarn;
  }
  assert.equal(warnings.some(([message]) => /cache.*transaction/i.test(String(message))), true);
});

test('concurrent filtered stores serialize MRU replacement without lost updates', async () => {
  const photoId = 'concurrent-mru';
  fakeDb.derived.set(`${photoId}@display`, new Blob(['base'], { type: 'image/jpeg' }));
  let releaseTwenty!: () => void;
  const twentyGate = new Promise<void>((resolve) => {
    releaseTwenty = resolve;
  });
  let twentyStarted!: () => void;
  const twentyStart = new Promise<void>((resolve) => {
    twentyStarted = resolve;
  });

  await withFakeLut(async (_blob, ref) => {
    if (ref.strength === 20) {
      twentyStarted();
      await twentyGate;
    }
    return new Blob([`${ref.strength}`], { type: 'image/jpeg' });
  }, async () => {
    await photoStore.getTierBlob(photoId, 'display', filterState('cloudy-cool', 10));
    const twenty = photoStore.getTierBlob(
      photoId,
      'display',
      filterState('cloudy-cool', 20),
    );
    await twentyStart;
    const thirty = photoStore.getTierBlob(
      photoId,
      'display',
      filterState('cloudy-cool', 30),
    );
    await thirty;
    releaseTwenty();
    await twenty;
  });

  const actual = [...fakeDb.derived.keys()].filter((key) =>
    key.startsWith(filteredVariantPrefix(photoId, 'display')));
  assert.deepEqual(new Set(actual), new Set([
    derivedCacheKey(photoId, 'display', { lutId: 'cloudy-cool', strength: 20 }),
    derivedCacheKey(photoId, 'display', { lutId: 'cloudy-cool', strength: 30 }),
  ]));
});

test('concurrent cache hit and store obey transaction order without losing the hit MRU', async () => {
  const photoId = 'concurrent-hit-store';
  fakeDb.derived.set(`${photoId}@display`, new Blob(['base'], { type: 'image/jpeg' }));
  let maintenanceStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    maintenanceStarted = resolve;
  });
  let releaseMaintenance!: () => void;
  const maintenanceGate = new Promise<void>((resolve) => {
    releaseMaintenance = resolve;
  });

  try {
    await withFakeLut(async (_blob, ref) => (
      new Blob([`${ref.strength}`], { type: 'image/jpeg' })
    ), async () => {
      await photoStore.getTierBlob(photoId, 'display', filterState('cloudy-cool', 10));
      await photoStore.getTierBlob(photoId, 'display', filterState('cloudy-cool', 20));
      let blockNextMaintenance = true;
      fakeDb.derivedRequestDelay = async (operation) => {
        if (operation !== 'getAllKeys' || !blockNextMaintenance) return;
        blockNextMaintenance = false;
        maintenanceStarted();
        await maintenanceGate;
      };

      const hit = photoStore.getTierBlob(
        photoId,
        'display',
        filterState('cloudy-cool', 10),
      );
      await started;
      const store = photoStore.getTierBlob(
        photoId,
        'display',
        filterState('cloudy-cool', 30),
      );
      releaseMaintenance();
      await Promise.all([hit, store]);
    });
  } finally {
    fakeDb.derivedRequestDelay = null;
  }

  const variants = [...fakeDb.derived.keys()].filter((key) =>
    key.startsWith(filteredVariantPrefix(photoId, 'display')));
  assert.deepEqual(new Set(variants), new Set([
    derivedCacheKey(photoId, 'display', { lutId: 'cloudy-cool', strength: 10 }),
    derivedCacheKey(photoId, 'display', { lutId: 'cloudy-cool', strength: 30 }),
  ]));
});

test('missing or corrupt metadata deterministically retains current plus one recoverable variant', async () => {
  const photoId = 'corrupt-recency';
  fakeDb.derived.set(`${photoId}@display`, new Blob(['base'], { type: 'image/jpeg' }));
  const key = (strength: number) => derivedCacheKey(
    photoId,
    'display',
    { lutId: 'cloudy-cool', strength },
  );
  fakeDb.derived.set(key(10), new Blob(['10'], { type: 'image/jpeg' }));
  fakeDb.derived.set(key(20), new Blob(['20'], { type: 'image/jpeg' }));
  fakeDb.derived.set(key(30), new Blob(['30'], { type: 'image/jpeg' }));
  fakeDb.derived.set(
    `${photoId}@display@pf-recency-v1`,
    { corrupt: true },
  );

  const current = await photoStore.getTierBlob(
    photoId,
    'display',
    filterState('cloudy-cool', 20),
  );

  assert.equal(await current?.text(), '20');
  const variants = [...fakeDb.derived.keys()].filter((candidate) =>
    candidate.startsWith(filteredVariantPrefix(photoId, 'display')));
  assert.deepEqual(variants.sort(), [key(10), key(20)].sort());
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

test('a filtered URL-cache hit durably touches MRU before a third variant is stored', async () => {
  const photoId = 'url-mru';
  fakeDb.derived.set(`${photoId}@display`, new Blob(['base'], { type: 'image/jpeg' }));
  const state = (strength: number) => filterState('cloudy-cool', strength);

  await withFakeLut(async (_blob, ref) => (
    new Blob([`${ref.strength}`], { type: 'image/jpeg' })
  ), async () => {
    const twentyUrl = await photoStore.getTierUrl(photoId, 'display', state(20));
    await photoStore.getTierBlob(photoId, 'display', state(80));
    assert.equal(await photoStore.getTierUrl(photoId, 'display', state(20)), twentyUrl);
    await photoStore.getTierBlob(photoId, 'display', state(60));
  });

  assert.equal(fakeDb.derived.has(derivedCacheKey(
    photoId,
    'display',
    { lutId: 'cloudy-cool', strength: 20 },
  )), true);
  assert.equal(fakeDb.derived.has(derivedCacheKey(
    photoId,
    'display',
    { lutId: 'cloudy-cool', strength: 60 },
  )), true);
  assert.equal(fakeDb.derived.has(derivedCacheKey(
    photoId,
    'display',
    { lutId: 'cloudy-cool', strength: 80 },
  )), false);
});

test('a URL-cache hit returns its URL and logs when its durable MRU touch fails', async () => {
  const photoId = 'url-touch-failure';
  fakeDb.derived.set(`${photoId}@display`, new Blob(['base'], { type: 'image/jpeg' }));
  const state = filterState('cloudy-cool', 35);
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  try {
    const url = await withFakeLut(async () => (
      new Blob(['35'], { type: 'image/jpeg' })
    ), () => photoStore.getTierUrl(photoId, 'display', state));
    const key = derivedCacheKey(
      photoId,
      'display',
      { lutId: 'cloudy-cool', strength: 35 },
    );
    fakeDb.derived.delete(key);
    console.warn = (...args: unknown[]) => warnings.push(args);

    assert.equal(await photoStore.getTierUrl(photoId, 'display', state), url);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0]?.[0]), /URL-cache MRU touch/);
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

test('omitted, null, and quantized-zero filters are equivalent across tier blob/url/batch APIs', async () => {
  const photoId = 'no-filter-equivalence';
  const base = new Blob(['base'], { type: 'image/jpeg' });
  fakeDb.derived.set(`${photoId}@display`, base);
  const zero = filterState('cloudy-cool', 2);
  let lutCalls = 0;

  await withFakeLut(async (blob) => {
    lutCalls += 1;
    return blob;
  }, async () => {
    assert.equal(await photoStore.getTierBlob(photoId, 'display'), base);
    assert.equal(await photoStore.getTierBlob(photoId, 'display', null), base);
    assert.equal(await photoStore.getTierBlob(photoId, 'display', zero), base);

    const omittedUrl = await photoStore.getTierUrl(photoId, 'display');
    assert.equal(await photoStore.getTierUrl(photoId, 'display', null), omittedUrl);
    assert.equal(await photoStore.getTierUrl(photoId, 'display', zero), omittedUrl);

    const omittedBatch = await photoStore.getTierUrls([photoId], 'display');
    assert.deepEqual(await photoStore.getTierUrls([photoId], 'display', null), omittedBatch);
    assert.deepEqual(await photoStore.getTierUrls([photoId], 'display', zero), omittedBatch);
  });

  assert.equal(lutCalls, 0);
});

test('getTierBlobStatus treats zero-strength LUT state as exact base bytes without LUT work', async () => {
  const photoId = 'backup-zero-filter-status';
  const base = new Blob(['base'], { type: 'image/jpeg' });
  fakeDb.derived.set(`${photoId}@display`, base);
  const state = filterState('cloudy-cool', 0);
  let lutCalls = 0;

  await withFakeLut(async (blob) => {
    lutCalls += 1;
    return blob;
  }, async () => {
    const status = await photoStore.getTierBlobStatus(photoId, 'display', state);
    assert.equal(status.blob, base);
    assert.equal(status.filteredFallback, false);
  });

  assert.equal(lutCalls, 0);
});

test('getTierBlobStatus exposes exact filtered success versus base fallback', async () => {
  const photoId = 'backup-filter-status';
  const base = new Blob(['base'], { type: 'image/jpeg' });
  fakeDb.derived.set(`${photoId}@display`, base);
  const state = filterState('cloudy-cool', 70);
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await withFakeLut(async (blob) => blob, async () => {
      const failed = await photoStore.getTierBlobStatus(photoId, 'display', state);
      assert.equal(failed.blob, base);
      assert.equal(failed.filteredFallback, true);
    });
    await withFakeLut(async () => new Blob(['filtered'], { type: 'image/jpeg' }), async () => {
      const exact = await photoStore.getTierBlobStatus(photoId, 'display', state);
      assert.equal(await exact.blob?.text(), 'filtered');
      assert.equal(exact.filteredFallback, false);
    });
  } finally {
    console.warn = originalWarn;
  }
});
