import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { photoStore } from './store';

/* ════════════════════════════════════════════════════════════════════════════
   导出取数的服务器备份回落。

   ── 这次修的是什么 ──────────────────────────────────────────────────────────
   「本地没有原图就用已备份的服务器压缩图」这条规则,原先**只实现在展示层的
   resolveImage 里**(EditorPort / MobileEditorRoot 都是 `imageUrls[id] ?? snapshotUrls[id]`),
   而导出链路自己另建了一个 resolver,只喂 photoStore.getPdfDataUrls 的结果 ——
   那个函数当时只读 IndexedDB 原图,`if (!blob) continue`,一行网络都没有。
   于是「已备份 + 本地没有原图」这个组合:屏幕上看得见,导出必然是空的。
   真机症状就是导出到相册的图片没有画面。

   ── 备份的字节是**已经带滤镜**的 ────────────────────────────────────────────
   备份上传的是 getTierBlobStatus(photoId, 'display', frozenState) —— display 档、
   滤镜已经烘进去了,renderVersion 就是拿滤镜算的。所以回落拿到备份之后**绝不能再
   套一次当前滤镜**,否则同一个 LUT 会被叠两遍。展示层用 snapshotUrls 时同样是原样用。
   ════════════════════════════════════════════════════════════════════════════ */

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..', '..');
const read = (...p: string[]) => readFileSync(join(...p), 'utf8');

/** 最小可用的浏览器解码桩:够 getPdfDataUrls 走完一趟,并记下每张图的来源字节。 */
function installDecodeMocks(seen: string[]): () => void {
  const g = globalThis as Record<string, unknown>;
  const original = {
    createImageBitmap: g.createImageBitmap,
    OffscreenCanvas: g.OffscreenCanvas,
    document: g.document,
  };
  const had = {
    createImageBitmap: 'createImageBitmap' in g,
    OffscreenCanvas: 'OffscreenCanvas' in g,
    document: 'document' in g,
  };

  g.createImageBitmap = async (blob: Blob) => {
    seen.push(await blob.text());
    return { width: 100, height: 80, close() {} };
  };
  g.OffscreenCanvas = class {
    width = 0;
    height = 0;
    getContext() {
      return { fillStyle: '', fillRect() {}, drawImage() {} };
    }
    convertToBlob() {
      return Promise.resolve(new Blob(['jpeg'], { type: 'image/jpeg' }));
    }
  };
  g.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ fillStyle: '', fillRect() {}, drawImage() {} }),
      toDataURL: () => 'data:image/jpeg;mock',
      toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['jpeg'], { type: 'image/jpeg' })),
    }),
  };

  return () => {
    for (const key of ['createImageBitmap', 'OffscreenCanvas', 'document'] as const) {
      if (had[key]) g[key] = original[key];
      else delete g[key];
    }
  };
}

test('本地有原图时不碰网络(备份只是回落,不是主路径)', async () => {
  const seen: string[] = [];
  const restore = installDecodeMocks(seen);
  const originalFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => {
    fetched += 1;
    throw new Error('should not be called');
  }) as typeof fetch;
  try {
    const store = Object.create(photoStore) as typeof photoStore;
    store.getBlob = async (id: string) => new Blob([`local:${id}`], { type: 'image/jpeg' });

    const out = await store.getPdfDataUrls(['a'], 900, null, { a: 'https://cdn/a.jpg' });

    assert.ok(out.a, '本地那张要出结果');
    assert.equal(fetched, 0, '本地有原图就不该去取备份');
    assert.deepEqual(seen, ['local:a']);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('本地没有原图但备份过 → 取备份的字节,不再是空图', async () => {
  const seen: string[] = [];
  const restore = installDecodeMocks(seen);
  const originalFetch = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(String(url));
    return { ok: true, blob: async () => new Blob(['backup-bytes'], { type: 'image/jpeg' }) };
  }) as unknown as typeof fetch;
  try {
    const store = Object.create(photoStore) as typeof photoStore;
    store.getBlob = async () => undefined; // 换了设备 / 清了缓存

    const out = await store.getPdfDataUrls(['a'], 900, null, { a: 'https://cdn/a.jpg' });

    assert.ok(out.a, '备份过的照片必须导得出来 —— 这就是这次的 bug');
    assert.deepEqual(asked, ['https://cdn/a.jpg']);
    assert.deepEqual(seen, ['backup-bytes']);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('备份字节已经带滤镜 → 回落时绝不再套一次(否则 LUT 叠两遍)', async () => {
  const seen: string[] = [];
  const restore = installDecodeMocks(seen);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    blob: async () => new Blob(['backup-bytes'], { type: 'image/jpeg' }),
  })) as unknown as typeof fetch;
  const { lutEngine } = await import('./lut/engine');
  const originalApply = lutEngine.applyToBlob;
  let lutCalls = 0;
  lutEngine.applyToBlob = async (blob: Blob) => {
    lutCalls += 1;
    return blob;
  };
  try {
    const store = Object.create(photoStore) as typeof photoStore;
    store.getBlob = async () => undefined;

    const out = await store.getPdfDataUrls(
      ['a'],
      900,
      { default: { lutId: 'cloudy-cool', strength: 80 } },
      { a: 'https://cdn/a.jpg' },
    );

    assert.ok(out.a);
    assert.equal(lutCalls, 0, '备份里滤镜已经烘进去了,再套一次就是同一个 LUT 叠两遍');
  } finally {
    lutEngine.applyToBlob = originalApply;
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('备份也取不到时安静跳过这一张,不拖垮整本导出', async () => {
  const restore = installDecodeMocks([]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) =>
    String(url).includes('good')
      ? { ok: true, blob: async () => new Blob(['ok'], { type: 'image/jpeg' }) }
      : { ok: false, status: 404 }) as unknown as typeof fetch;
  try {
    const store = Object.create(photoStore) as typeof photoStore;
    store.getBlob = async () => undefined;

    const out = await store.getPdfDataUrls(['bad', 'good'], 900, null, {
      bad: 'https://cdn/bad.jpg',
      good: 'https://cdn/good.jpg',
    });

    assert.equal(out.bad, undefined, '取不到就跳过这一张');
    assert.ok(out.good, '同批其它照片不受影响');
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('没给备份表时行为与从前完全一致(纯本地)', async () => {
  const restore = installDecodeMocks([]);
  const originalFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => {
    fetched += 1;
    throw new Error('should not be called');
  }) as typeof fetch;
  try {
    const store = Object.create(photoStore) as typeof photoStore;
    store.getBlob = async () => undefined;

    const out = await store.getPdfDataUrls(['a'], 900);

    assert.deepEqual(out, {});
    assert.equal(fetched, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

/* ── 接线:两条导出链路都必须把备份表递进去 ────────────────────────────────── */

test('移动端与桌面的导出输入都接上了服务器备份回落', () => {
  const mobile = read(srcRoot, 'components/album/editor-v2/mobile/use-export.ts');
  const desktop = read(srcRoot, 'components/album/editor-v2/EditorPort.tsx') + '\n\n' + read(srcRoot, 'components/album/editor-v2/EditorBook.tsx');

  for (const [name, src] of [
    ['mobile use-export', mobile],
    ['desktop EditorPort', desktop],
  ] as const) {
    assert.match(
      src,
      /getPdfDataUrls\([\s\S]{0,200}snapshotUrls/,
      `${name} 的导出取数必须把备份 URL 表递给 getPdfDataUrls`,
    );
  }
});

test('展示层与导出层用的是同一份备份表,不各存一份', () => {
  const mobileRoot = read(srcRoot, 'components/album/editor-v2/mobile/MobileEditorRoot.tsx');
  // 展示层那条回落照旧;导出层现在读同一个 detail.album.photoSnapshotUrls。
  assert.match(mobileRoot, /imageUrls\[id\] \?\? snapshotUrls\[id\]/);
  assert.match(mobileRoot, /photoSnapshotUrls: snapshotUrls|snapshotUrls=\{snapshotUrls\}|snapshotUrls,/);
});

/* ── 上传档提到 3400 + renderVersion 的红线 ────────────────────────────────── */

test('备份传的是 3400 的上传档,不是 1600 的屏显档', async () => {
  const { TIER_MAX_EDGE, RASTER_PDF_IMAGE_MAX_EDGE } = await import('./store');
  assert.equal(TIER_MAX_EDGE.backup, 3400);
  assert.equal(
    TIER_MAX_EDGE.backup,
    RASTER_PDF_IMAGE_MAX_EDGE,
    '上传档必须与导出档持平,否则换设备导出永远要放大',
  );
  assert.equal(TIER_MAX_EDGE.display, 1600, '屏显档不许被顺手改大(内存回归)');

  const store = read(here, 'store.ts');
  assert.match(store, /UNCACHED_TIERS[\s\S]{0,80}'backup'/, '上传档不该进本地派生缓存');
  // 两条落盘路径都要堵:无滤镜(getBaseTierBlob) + 带滤镜(maintainFilteredVariant)。
  assert.equal(
    (store.match(/UNCACHED_TIERS\.has\(tier\)/g) ?? []).length,
    2,
    '只堵无滤镜那条等于没堵 —— 备份的常态就是带滤镜',
  );

  for (const [name, src] of [
    ['EditorPort', read(srcRoot, 'components/album/editor-v2/EditorPort.tsx') + '\n\n' + read(srcRoot, 'components/album/editor-v2/EditorBook.tsx')],
    ['use-photo-backup', read(srcRoot, 'components/album/editor-v2/mobile/use-photo-backup.ts')],
  ] as const) {
    assert.match(src, /getTierBlobStatus\([^)]*'backup'/, `${name} 备份要用上传档`);
  }
});

test('renderVersion 只编滤镜 —— 档位一旦进去,存量分享全变 409', async () => {
  const { effectiveRenderVersion } = await import('./filter-state');
  const state = { default: { lutId: 'cloudy-cool', strength: 80 } } as never;
  const version = effectiveRenderVersion(state, 'p1');
  assert.equal(version, 'pf-v1__cloudy-cool__80');
  assert.doesNotMatch(version, /3400|1600|backup|display/, '版本号里不许出现档位');
  assert.equal(effectiveRenderVersion(null, 'p1'), 'pf-v1__original');

  // 分享闸门就是拿它逐张比对的:版本号变了 = 全部「未备份当前版本」→ 409。
  const share = read(srcRoot, 'services/album/share-service.ts');
  assert.match(share, /recordedVersions\[photoId\] === effectiveRenderVersion\(album\.photoFilter, photoId\)/);
});

test('升档要靠显式「重新备份」,不能指望自动 —— 版本号没变就不会重传', async () => {
  const { createFrozenBackupPlan } = await import(
    '../../components/album/editor-v2/filter-controller'
  );
  const ids = ['a', 'b'];
  const versions = { a: 'pf-v1__original', b: 'pf-v1__original' };

  // 默认:版本号一致 → 无事可做(存量 1600 的备份就是这样卡住的)
  assert.equal(createFrozenBackupPlan(ids, null, versions).pending.length, 0);
  // force:整本重传,同 key 同版本、只是字节更好 → 不动 renderVersion,零 409 风险
  const forced = createFrozenBackupPlan(ids, null, versions, true);
  assert.equal(forced.pending.length, 2);
  assert.deepEqual(
    forced.pending.map((e) => e.renderVersion),
    ['pf-v1__original', 'pf-v1__original'],
    'force 不许改版本号',
  );
});

test('两端导出策略统一:都能导,都如实告知(桌面不再换成「下载 PDF」)', () => {
  const editor = read(srcRoot, 'components/album/editor-v2/EditorPort.tsx') + '\n\n' + read(srcRoot, 'components/album/editor-v2/EditorBook.tsx');
  assert.match(editor, /exportSourceNotice/, '桌面导出前要告知有几张走云端备份图');
  assert.match(editor, /export-source-notice/);
  assert.doesNotMatch(
    editor,
    /labelEl\.textContent = aT\('下载 PDF'/,
    '§5.4 那道「本机没原图就不给导出」的闸已经撤掉,两端统一为「能导 + 告知」',
  );
});

/* ════════════════════════════════════════════════════════════════════════════
   抠图必须也走导出这条路。

   getPdfDataUrls 早先只认 LUT,完全不看 cutouts —— 画板上主体已经抠出来了,导出的
   PDF / 单页图 / 拼图里背景还在。而抠图的 alpha 必须来自**服务端 mask**(浏览器端
   那套漫水填充无语义,2026-08-29 实测棚拍人像 5 张 0 张能用而被否决),画板与导出
   还得用**同一张** mask,否则两边不一致。
   ════════════════════════════════════════════════════════════════════════════ */

/** Node 里没有 FileReader,而抠图产物走的正是 blobToDataUrl。最小可用的桩。 */
function installFileReader(): () => void {
  const g = globalThis as Record<string, unknown>;
  const had = 'FileReader' in g;
  const original = g.FileReader;
  g.FileReader = class {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    error: unknown = null;
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((buf) => {
        this.result = `data:${blob.type};base64,${Buffer.from(buf).toString('base64')}`;
        this.onload?.();
      });
    }
  };
  return () => {
    if (had) g.FileReader = original;
    else delete g.FileReader;
  };
}

async function withCutoutStub<T>(
  stub: { applyToBlob?: (b: Blob) => Promise<Blob>; applyMaskToBlob?: (b: Blob, m: Blob) => Promise<Blob> },
  run: () => Promise<T>,
): Promise<T> {
  const { cutoutEngine } = await import('./cutout/engine');
  const originals = { a: cutoutEngine.applyToBlob, m: cutoutEngine.applyMaskToBlob };
  if (stub.applyToBlob) cutoutEngine.applyToBlob = stub.applyToBlob as typeof cutoutEngine.applyToBlob;
  if (stub.applyMaskToBlob) {
    cutoutEngine.applyMaskToBlob = stub.applyMaskToBlob as typeof cutoutEngine.applyMaskToBlob;
  }
  try {
    return await run();
  } finally {
    cutoutEngine.applyToBlob = originals.a;
    cutoutEngine.applyMaskToBlob = originals.m;
  }
}

test('导出取数对抠图照片用服务端 mask —— 画板抠了导出也得抠', async () => {
  const restoreReader = installFileReader();
  const restore = installDecodeMocks([]);
  const mask = new Blob(['mask-bytes'], { type: 'image/png' });
  let maskCalls = 0;
  photoStore.setPhotoMaskFetcher(async () => mask);
  try {
    const store = Object.create(photoStore) as typeof photoStore;
    store.getBlob = async () => new Blob(['local'], { type: 'image/jpeg' });

    const out = await withCutoutStub({
      applyMaskToBlob: async (_b, m) => {
        maskCalls += 1;
        assert.equal(await m.text(), 'mask-bytes');
        return new Blob(['cut-webp'], { type: 'image/webp' });
      },
      applyToBlob: async () => { throw new Error('有 mask 就不该退回漫水填充'); },
    }, () => store.getPdfDataUrls(['a'], 900, { default: null, cutouts: { a: true } }));

    assert.equal(maskCalls, 1);
    assert.match(out.a!, /^data:image\/webp/, '抠图产物带 alpha,不能编码成 JPEG');
  } finally {
    photoStore.setPhotoMaskFetcher(null);
    restore();
    restoreReader();
  }
});

test('导出:没开抠图的照片一个字节都不变(老书零影响)', async () => {
  const seen: string[] = [];
  const restore = installDecodeMocks(seen);
  photoStore.setPhotoMaskFetcher(async () => { throw new Error('没抠图不该问 mask'); });
  try {
    const store = Object.create(photoStore) as typeof photoStore;
    store.getBlob = async () => new Blob(['local'], { type: 'image/jpeg' });
    const out = await withCutoutStub({
      applyToBlob: async () => { throw new Error('不该抠'); },
      applyMaskToBlob: async () => { throw new Error('不该抠'); },
    }, () => store.getPdfDataUrls(['a'], 900, null));
    assert.ok(out.a);
  } finally {
    photoStore.setPhotoMaskFetcher(null);
    restore();
  }
});

test('导出:取不到 mask 时退回浏览器端抠图,不是干脆不抠', async () => {
  const restoreReader = installFileReader();
  const restore = installDecodeMocks([]);
  photoStore.setPhotoMaskFetcher(async () => undefined);
  let localCalls = 0;
  try {
    const store = Object.create(photoStore) as typeof photoStore;
    store.getBlob = async () => new Blob(['local'], { type: 'image/jpeg' });
    const out = await withCutoutStub({
      applyToBlob: async () => { localCalls += 1; return new Blob(['cut-local'], { type: 'image/webp' }); },
      applyMaskToBlob: async () => { throw new Error('没 mask 不该走这条'); },
    }, () => store.getPdfDataUrls(['a'], 900, { default: null, cutouts: { a: true } }));
    assert.equal(localCalls, 1);
    assert.match(out.a!, /^data:image\/webp/);
  } finally {
    photoStore.setPhotoMaskFetcher(null);
    restore();
    restoreReader();
  }
});
