import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import type { LutId } from '../filter-state';
import { createSerialExecutor, createLutEngineForTesting, type LutCanvas } from './engine';
import { createLutResourceLoaderForTesting } from './resource-loader';

const THUMB_SIZE = 17;
const FULL_SIZE = 33;
const THUMB_BYTES = THUMB_SIZE ** 3 * 3;
const FULL_BYTES = FULL_SIZE ** 3 * 3;
const LUT_COUNT = 26;

test('serial executor starts jobs FIFO even when the first job resolves later', async () => {
  const events: string[] = [];
  const run = createSerialExecutor();
  const first = run(async () => {
    events.push('a:start');
    await Promise.resolve();
    events.push('a:end');
    return 'a';
  });
  const second = run(async () => {
    events.push('b:start');
    events.push('b:end');
    return 'b';
  });

  assert.deepEqual(await Promise.all([first, second]), ['a', 'b']);
  assert.deepEqual(events, ['a:start', 'a:end', 'b:start', 'b:end']);
});

test('serial executor recovers after a rejected job', async () => {
  const events: string[] = [];
  const run = createSerialExecutor();
  const failed = run(async () => {
    events.push('failed');
    throw new Error('expected');
  });
  const recovered = run(async () => {
    events.push('recovered');
    return 42;
  });

  await assert.rejects(failed, /expected/);
  assert.equal(await recovered, 42);
  assert.deepEqual(events, ['failed', 'recovered']);
});

test('thumb loader fetches the static combined URL once and returns manifest-ordered views', async () => {
  const payload = new Uint8Array(THUMB_BYTES * LUT_COUNT);
  payload[0] = 11;
  payload[THUMB_BYTES] = 22;
  const urls: string[] = [];
  const loader = createLutResourceLoaderForTesting(async (url) => {
    urls.push(String(url));
    return new Response(gzipBody(payload), { status: 200 });
  });

  const first = await loader.loadThumbLut('cloudy-cool');
  const second = await loader.loadThumbLut('street-negative');
  const firstAgain = await loader.loadThumbLut('cloudy-cool');

  assert.deepEqual(urls, ['/luts/thumbs.bin.gz']);
  assert.equal(first.byteLength, THUMB_BYTES);
  assert.equal(second.byteLength, THUMB_BYTES);
  assert.equal(first[0], 11);
  assert.equal(second[0], 22);
  assert.equal(first.buffer, second.buffer, 'manifest slices must be zero-copy views of one decoded payload');
  assert.equal(firstAgain, first, 'resolved per-LUT promise must retain an unambiguous view');
});

test('full loader uses only a trusted ID in the exact static URL and caches the result', async () => {
  const urls: string[] = [];
  const payload = new Uint8Array(FULL_BYTES).fill(7);
  const loader = createLutResourceLoaderForTesting(async (url) => {
    urls.push(String(url));
    return new Response(gzipBody(payload), { status: 200 });
  });

  const first = await loader.loadFullLut('green-book');
  const second = await loader.loadFullLut('green-book');

  assert.equal(first, second);
  assert.deepEqual(urls, ['/luts/full/green-book.bin.gz']);

  await assert.rejects(
    loader.loadFullLut('../forged' as LutId),
    /trusted LUT id/,
  );
  assert.deepEqual(urls, ['/luts/full/green-book.bin.gz'], 'forged IDs must never reach fetch');
});

test('resource loader coalesces simultaneous calls onto the same in-flight promise', async () => {
  const response = deferred<Response>();
  let fetchCalls = 0;
  const loader = createLutResourceLoaderForTesting(async () => {
    fetchCalls += 1;
    return response.promise;
  });

  const first = loader.loadFullLut('cloudy-cool');
  const joined = loader.loadFullLut('cloudy-cool');
  assert.equal(first, joined);
  assert.equal(fetchCalls, 1);

  response.resolve(new Response(gzipBody(new Uint8Array(FULL_BYTES)), { status: 200 }));
  assert.equal((await first).byteLength, FULL_BYTES);

  const thumbsResponse = deferred<Response>();
  let thumbFetchCalls = 0;
  const thumbLoader = createLutResourceLoaderForTesting(async () => {
    thumbFetchCalls += 1;
    return thumbsResponse.promise;
  });
  const firstThumb = thumbLoader.loadThumbLut('cloudy-cool');
  const secondThumb = thumbLoader.loadThumbLut('street-negative');
  assert.equal(thumbFetchCalls, 1, 'different IDs must share the combined in-flight payload');
  thumbsResponse.resolve(
    new Response(gzipBody(new Uint8Array(THUMB_BYTES * LUT_COUNT)), { status: 200 }),
  );
  const [firstView, secondView] = await Promise.all([firstThumb, secondThumb]);
  assert.equal(firstView.buffer, secondView.buffer);
});

test('rejected in-flight promise eviction is identity-safe and the retry is coalesced', async () => {
  const firstFetch = deferred<Response>();
  const retryFetch = deferred<Response>();
  let fetchCalls = 0;
  const loader = createLutResourceLoaderForTesting(async () => {
    fetchCalls += 1;
    return fetchCalls === 1 ? firstFetch.promise : retryFetch.promise;
  });

  const failed = loader.loadFullLut('cloudy-cool');
  assert.equal(loader.loadFullLut('cloudy-cool'), failed);
  firstFetch.reject(new Error('network offline'));
  await assert.rejects(failed, /cloudy-cool\.bin\.gz.*network offline/);

  const retry = loader.loadFullLut('cloudy-cool');
  assert.notEqual(retry, failed);
  assert.equal(loader.loadFullLut('cloudy-cool'), retry);
  retryFetch.resolve(new Response(gzipBody(new Uint8Array(FULL_BYTES)), { status: 200 }));
  assert.equal((await retry).byteLength, FULL_BYTES);
  assert.equal(fetchCalls, 2);
});

test('resource loader retries every fetch, body, gzip, and length failure with URL diagnostics', async (t) => {
  const failures: Array<{
    name: string;
    response: () => Promise<Response>;
    detail: RegExp;
  }> = [
    {
      name: 'fetch rejection',
      response: async () => {
        throw new Error('socket closed');
      },
      detail: /socket closed/,
    },
    {
      name: 'non-ok response',
      response: async () => new Response('missing', { status: 503 }),
      detail: /HTTP 503/,
    },
    {
      name: 'missing body',
      response: async () => new Response(null, { status: 200 }),
      detail: /no response body/,
    },
    {
      name: 'corrupt gzip stream',
      response: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
      detail: /gzip|decompress|invalid|incorrect/i,
    },
    {
      name: 'wrong decoded length',
      response: async () => new Response(gzipBody(new Uint8Array(3)), { status: 200 }),
      detail: /decoded length/,
    },
  ];

  for (const failure of failures) {
    await t.test(failure.name, async () => {
      let attempts = 0;
      const loader = createLutResourceLoaderForTesting(async () => {
        attempts += 1;
        if (attempts === 1) return failure.response();
        return new Response(gzipBody(new Uint8Array(FULL_BYTES)), { status: 200 });
      });

      await assert.rejects(
        loader.loadFullLut('green-book'),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /\/luts\/full\/green-book\.bin\.gz/);
          assert.match(error.message, failure.detail);
          assert.ok(error.cause instanceof Error, 'lower-level failure must be retained as cause');
          return true;
        },
      );
      assert.equal((await loader.loadFullLut('green-book')).byteLength, FULL_BYTES);
      assert.equal(attempts, 2);
    });
  }
});

test('resource loader rejects HTTP and decoded-length failures, then clears cache for retry', async () => {
  let attempts = 0;
  const loader = createLutResourceLoaderForTesting(async () => {
    attempts += 1;
    if (attempts === 1) return new Response('missing', { status: 404 });
    if (attempts === 2) return new Response(gzipBody(new Uint8Array(3)), { status: 200 });
    return new Response(gzipBody(new Uint8Array(FULL_BYTES)), { status: 200 });
  });

  await assert.rejects(loader.loadFullLut('cloudy-cool'), /HTTP 404/);
  await assert.rejects(loader.loadFullLut('cloudy-cool'), /decoded length/);
  assert.equal((await loader.loadFullLut('cloudy-cool')).byteLength, FULL_BYTES);
  assert.equal(attempts, 3);
});

test('missing DecompressionStream fails diagnostically and remains retryable', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'DecompressionStream');
  const loader = createLutResourceLoaderForTesting(async () =>
    new Response(gzipBody(new Uint8Array(FULL_BYTES)), { status: 200 }));
  Object.defineProperty(globalThis, 'DecompressionStream', { configurable: true, value: undefined });
  try {
    await assert.rejects(loader.loadFullLut('cloudy-cool'), /DecompressionStream/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'DecompressionStream', descriptor);
    else delete (globalThis as { DecompressionStream?: unknown }).DecompressionStream;
  }
  assert.equal((await loader.loadFullLut('cloudy-cool')).byteLength, FULL_BYTES);
});

test('node without WebGL returns the exact original Blob and bypasses strength zero', async () => {
  let decodeCalls = 0;
  let loadCalls = 0;
  const logger = recordingLogger();
  const engine = createLutEngineForTesting({
    createOffscreenCanvas: () => null,
    createDomCanvas: () => null,
    decodeBlob: async () => {
      decodeCalls += 1;
      throw new Error('must not decode');
    },
    loadFullLut: async () => {
      loadCalls += 1;
      throw new Error('must not load');
    },
    loadThumbLut: async () => {
      loadCalls += 1;
      throw new Error('must not load');
    },
    logger,
  });
  const original = new Blob(['original'], { type: 'image/jpeg' });

  assert.equal(engine.isSupported(), false);
  assert.equal(await engine.applyToBlob(original, { lutId: 'cloudy-cool', strength: 100 }, 'full'), original);
  assert.equal(await engine.applyToBlob(original, { lutId: 'cloudy-cool', strength: 0 }, 'full'), original);
  assert.equal(decodeCalls, 0);
  assert.equal(loadCalls, 0);
  assert.match(logger.warnings.join('\n'), /no WebGL2 canvas route succeeded/);
});

test('strength uses the shared 5-point quantization for bypass and GPU uniform', async () => {
  const events: string[] = [];
  const gl = createFakeGl(events);
  let decodeCalls = 0;
  let loadCalls = 0;
  let canvasCalls = 0;
  const engine = createLutEngineForTesting({
    createOffscreenCanvas: () => {
      canvasCalls += 1;
      return fakeCanvas(gl, events, 'offscreen');
    },
    createDomCanvas: () => null,
    decodeBlob: async () => {
      decodeCalls += 1;
      return fakeBitmap(events);
    },
    loadFullLut: async () => {
      loadCalls += 1;
      return new Uint8Array(FULL_BYTES);
    },
    loadThumbLut: async () => new Uint8Array(THUMB_BYTES),
    logger: quietLogger,
  });
  const nearZero = new Blob(['near-zero'], { type: 'image/jpeg' });
  const quantized = new Blob(['quantized'], { type: 'image/jpeg' });

  assert.equal(await engine.applyToBlob(nearZero, { lutId: 'cloudy-cool', strength: 2 }), nearZero);
  assert.equal(canvasCalls, 0);
  assert.equal(decodeCalls, 0);
  assert.equal(loadCalls, 0);

  await engine.applyToBlob(quantized, { lutId: 'cloudy-cool', strength: 52 });
  assert.ok(events.includes('uniform1f:uStrength:0.5'));
  assert.equal(decodeCalls, 1);
  assert.equal(loadCalls, 1);
});

test('PNG/WebP contract preserves straight alpha through decode, upload, shader, and encode', async () => {
  const events: string[] = [];
  const shaderSources: string[] = [];
  const gl = createFakeGl(events, { shaderSources });
  const contextAttributes: Array<WebGLContextAttributes | undefined> = [];
  const canvas = fakeCanvas(gl, events, 'offscreen', contextAttributes);
  const encodedTypes: string[] = [];
  canvas.encode = async (type) => {
    encodedTypes.push(type);
    return new Blob(['filtered'], { type });
  };
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const hadCreateImageBitmap = 'createImageBitmap' in globalThis;
  const bitmap = fakeBitmap(events);
  const decodeOptions: ImageBitmapOptions[] = [];
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async (_blob: Blob, options: ImageBitmapOptions) => {
      decodeOptions.push(options);
      return bitmap;
    },
  });
  try {
    const engine = createLutEngineForTesting({
      createOffscreenCanvas: () => canvas,
      createDomCanvas: () => null,
      loadFullLut: async () => new Uint8Array(FULL_BYTES),
      loadThumbLut: async () => new Uint8Array(THUMB_BYTES),
      logger: quietLogger,
    });
    for (const type of ['image/png', 'image/webp', 'image/jpeg']) {
      const result = await engine.applyToBlob(
        new Blob(['pixels'], { type }),
        { lutId: 'cloudy-cool', strength: 100 },
      );
      assert.equal(result.type, type);
    }

    assert.deepEqual(encodedTypes, ['image/png', 'image/webp', 'image/jpeg']);
    assert.deepEqual(
      decodeOptions,
      Array.from({ length: 3 }, () => ({
        imageOrientation: 'from-image' as const,
        premultiplyAlpha: 'none' as const,
      })),
    );
    assert.deepEqual(contextAttributes, [{
      alpha: true,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
    }]);
    const fragment = shaderSources.find((source) => source.includes('sampler3D'));
    assert.ok(fragment);
    assert.match(fragment, /vec4 source = texture\(uImage, vUV\)/);
    assert.match(fragment, /source\.a/);
    assert.doesNotMatch(fragment, /mix\(c, g, uStrength\), 1\.0/);
    assert.ok(events.includes('pixelStorei:UNPACK_PREMULTIPLY_ALPHA_WEBGL:false'));
  } finally {
    if (hadCreateImageBitmap) {
      Object.defineProperty(globalThis, 'createImageBitmap', {
        configurable: true,
        value: originalCreateImageBitmap,
      });
    } else {
      delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
    }
  }
});

test('Offscreen WebGL2 failure independently falls back to a hidden DOM canvas', () => {
  const events: string[] = [];
  const gl = {} as WebGL2RenderingContext;
  const offscreen = fakeCanvas(null, events, 'offscreen');
  const dom = fakeCanvas(gl, events, 'dom');
  const engine = createLutEngineForTesting({
    createOffscreenCanvas: () => offscreen,
    createDomCanvas: () => dom,
    logger: quietLogger,
  });

  assert.equal(engine.isSupported(), true);
  assert.deepEqual(events, ['offscreen:webgl2', 'offscreen:dispose', 'dom:webgl2']);
});

test('failed canvas discovery is not cached and a later support check can retry', () => {
  const events: string[] = [];
  const gl = {} as WebGL2RenderingContext;
  let attempt = 0;
  const engine = createLutEngineForTesting({
    createOffscreenCanvas: () => {
      attempt += 1;
      return attempt === 1 ? null : fakeCanvas(gl, events, 'offscreen');
    },
    createDomCanvas: () => null,
    logger: quietLogger,
  });

  assert.equal(engine.isSupported(), false);
  assert.equal(engine.isSupported(), true);
  assert.deepEqual(events, ['offscreen:webgl2']);
});

test('context loss drops canvas and texture state so a later attempt can recreate it', () => {
  const events: string[] = [];
  const contexts = [
    {} as WebGL2RenderingContext,
    {} as WebGL2RenderingContext,
  ];
  let createCount = 0;
  let loseContext!: () => void;
  const engine = createLutEngineForTesting({
    createOffscreenCanvas: () => {
      const canvas = fakeCanvas(contexts[createCount], events, `offscreen-${createCount}`);
      createCount += 1;
      canvas.onContextLost = (handler) => {
        loseContext = handler;
      };
      return canvas;
    },
    createDomCanvas: () => null,
    logger: quietLogger,
  });

  assert.equal(engine.isSupported(), true);
  loseContext();
  assert.equal(engine.isSupported(), true);
  assert.equal(createCount, 2);
  assert.ok(events.includes('offscreen-0:dispose'));
});

test('resource failure returns the original and closes the decoded bitmap', async () => {
  const events: string[] = [];
  const bitmap = fakeBitmap(events);
  const gl = createFakeGl(events);
  const logger = recordingLogger();
  const engine = createLutEngineForTesting({
    createOffscreenCanvas: () => fakeCanvas(gl, events, 'offscreen'),
    createDomCanvas: () => null,
    decodeBlob: async () => bitmap,
    loadFullLut: async () => {
      events.push('lut:load');
      throw new Error('resource unavailable');
    },
    loadThumbLut: async () => new Uint8Array(THUMB_BYTES),
    logger,
  });
  const original = new Blob(['original'], { type: 'image/jpeg' });

  assert.equal(await engine.applyToBlob(original, { lutId: 'cloudy-cool', strength: 100 }, 'full'), original);
  assert.ok(events.includes('bitmap:close'));
  assert.match(logger.errors.join('\n'), /resource unavailable/);
});

test('createImageBitmap rejection logs the decode failure and returns the exact original reference', async () => {
  const events: string[] = [];
  const logger = recordingLogger();
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const hadCreateImageBitmap = 'createImageBitmap' in globalThis;
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async () => {
      throw new Error('bitmap decode rejected');
    },
  });
  try {
    const engine = createLutEngineForTesting({
      createOffscreenCanvas: () => fakeCanvas(createFakeGl(events), events, 'offscreen'),
      createDomCanvas: () => null,
      loadFullLut: async () => {
        throw new Error('must not load after decode failure');
      },
      logger,
    });
    const original = new Blob(['broken'], { type: 'image/png' });

    assert.equal(await engine.applyToBlob(original, { lutId: 'cloudy-cool', strength: 100 }), original);
    assert.match(logger.errors.join('\n'), /bitmap decode rejected/);
  } finally {
    if (hadCreateImageBitmap) {
      Object.defineProperty(globalThis, 'createImageBitmap', {
        configurable: true,
        value: originalCreateImageBitmap,
      });
    } else {
      delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
    }
  }
});

for (const shaderFailure of [
  { name: 'shader compile failure', options: { compileResults: [false, true, true] }, diagnostic: /compile/i },
  { name: 'shader link failure', options: { linkResults: [false, true] }, diagnostic: /link/i },
  { name: 'missing shader uniform', options: { missingUniformOnce: 'uStrength' }, diagnostic: /uStrength/ },
] as const) {
  test(`${shaderFailure.name} falls back, logs, and leaves a later retry usable`, async () => {
    const events: string[] = [];
    const logger = recordingLogger();
    const gl = createFakeGl(events, shaderFailure.options);
    const engine = createLutEngineForTesting({
      createOffscreenCanvas: () => fakeCanvas(gl, events, 'offscreen'),
      createDomCanvas: () => null,
      decodeBlob: async () => fakeBitmap(events),
      loadFullLut: async () => new Uint8Array(FULL_BYTES),
      loadThumbLut: async () => new Uint8Array(THUMB_BYTES),
      logger,
    });
    const failed = new Blob(['failed'], { type: 'image/jpeg' });
    const retry = new Blob(['retry'], { type: 'image/jpeg' });

    assert.equal(await engine.applyToBlob(failed, { lutId: 'cloudy-cool', strength: 100 }), failed);
    assert.match(logger.errors.join('\n'), shaderFailure.diagnostic);
    assert.notEqual(await engine.applyToBlob(retry, { lutId: 'cloudy-cool', strength: 100 }), retry);
    assert.ok(events.includes('draw'));
  });
}

test('render failure returns original, deletes the per-image texture, and closes the bitmap', async () => {
  const events: string[] = [];
  const bitmap = fakeBitmap(events);
  const gl = createFakeGl(events, { failDraw: true });
  const logger = recordingLogger();
  const engine = createLutEngineForTesting({
    createOffscreenCanvas: () => fakeCanvas(gl, events, 'offscreen'),
    createDomCanvas: () => null,
    decodeBlob: async () => bitmap,
    loadFullLut: async () => new Uint8Array(FULL_BYTES),
    loadThumbLut: async () => new Uint8Array(THUMB_BYTES),
    logger,
  });
  const original = new Blob(['original'], { type: 'image/jpeg' });

  assert.equal(await engine.applyToBlob(original, { lutId: 'cloudy-cool', strength: 100 }, 'full'), original);
  assert.ok(events.includes('texture:delete:image'));
  assert.ok(events.includes('bitmap:close'));
  assert.match(logger.errors.join('\n'), /draw failed/);
});

test('encode failure returns original after deleting the image texture and closing the bitmap', async () => {
  const events: string[] = [];
  const bitmap = fakeBitmap(events);
  const gl = createFakeGl(events);
  const canvas = fakeCanvas(gl, events, 'offscreen');
  const logger = recordingLogger();
  canvas.encode = async () => {
    events.push('offscreen:encode');
    throw new Error('encode failed');
  };
  const engine = createLutEngineForTesting({
    createOffscreenCanvas: () => canvas,
    createDomCanvas: () => null,
    decodeBlob: async () => bitmap,
    loadFullLut: async () => new Uint8Array(FULL_BYTES),
    loadThumbLut: async () => new Uint8Array(THUMB_BYTES),
    logger,
  });
  const original = new Blob(['original'], { type: 'image/jpeg' });

  assert.equal(await engine.applyToBlob(original, { lutId: 'cloudy-cool', strength: 100 }, 'full'), original);
  assert.ok(events.includes('offscreen:encode'));
  assert.ok(events.includes('texture:delete:image'));
  assert.ok(events.includes('bitmap:close'));
  assert.match(logger.errors.join('\n'), /encode failed/);
});

test('engine keeps the async encode inside its FIFO lifecycle', async () => {
  const events: string[] = [];
  const gl = createFakeGl(events);
  const canvas = fakeCanvas(gl, events, 'offscreen');
  let releaseFirstEncode!: () => void;
  let announceFirstEncode!: () => void;
  const firstEncodeStarted = new Promise<void>((resolve) => {
    announceFirstEncode = resolve;
  });
  let encodeCount = 0;
  canvas.encode = async () => {
    encodeCount += 1;
    events.push(`encode:${encodeCount}:start`);
    if (encodeCount === 1) {
      announceFirstEncode();
      await new Promise<void>((resolve) => {
        releaseFirstEncode = resolve;
      });
    }
    events.push(`encode:${encodeCount}:end`);
    return new Blob([`filtered-${encodeCount}`], { type: 'image/jpeg' });
  };
  let decodeCount = 0;
  const engine = createLutEngineForTesting({
    createOffscreenCanvas: () => canvas,
    createDomCanvas: () => null,
    decodeBlob: async () => {
      decodeCount += 1;
      events.push(`decode:${decodeCount}`);
      return fakeBitmap(events);
    },
    loadFullLut: async () => new Uint8Array(FULL_BYTES),
    loadThumbLut: async () => new Uint8Array(THUMB_BYTES),
    logger: quietLogger,
  });

  const first = engine.applyToBlob(
    new Blob(['first'], { type: 'image/jpeg' }),
    { lutId: 'cloudy-cool', strength: 100 },
  );
  await firstEncodeStarted;
  const second = engine.applyToBlob(
    new Blob(['second'], { type: 'image/jpeg' }),
    { lutId: 'cloudy-cool', strength: 100 },
  );
  await Promise.resolve();
  assert.equal(decodeCount, 1, 'the second decode must wait for the first async encode');

  releaseFirstEncode();
  await Promise.all([first, second]);
  assert.equal(decodeCount, 2);
  assert.ok(events.indexOf('encode:1:end') < events.indexOf('decode:2'));
});

test('context loss during an in-flight job falls back that job and rebuilds for the queued retry', async () => {
  const events: string[] = [];
  const decode = deferred<ReturnType<typeof fakeBitmap>>();
  const decodeStarted = deferred<void>();
  const contexts = [createFakeGl(events), createFakeGl(events)];
  let contextIndex = 0;
  let loseFirstContext!: () => void;
  const engine = createLutEngineForTesting({
    createOffscreenCanvas: () => {
      const index = contextIndex++;
      const canvas = fakeCanvas(contexts[index], events, `offscreen-${index}`);
      canvas.onContextLost = (handler) => {
        if (index === 0) loseFirstContext = handler;
      };
      return canvas;
    },
    createDomCanvas: () => null,
    decodeBlob: async () => {
      if (contextIndex === 1) {
        decodeStarted.resolve();
        return decode.promise;
      }
      return fakeBitmap(events);
    },
    loadFullLut: async () => new Uint8Array(FULL_BYTES),
    loadThumbLut: async () => new Uint8Array(THUMB_BYTES),
    logger: quietLogger,
  });
  const firstOriginal = new Blob(['first'], { type: 'image/jpeg' });
  const secondOriginal = new Blob(['second'], { type: 'image/jpeg' });
  const first = engine.applyToBlob(firstOriginal, { lutId: 'cloudy-cool', strength: 100 });
  await decodeStarted.promise;
  const queued = engine.applyToBlob(secondOriginal, { lutId: 'cloudy-cool', strength: 100 });

  loseFirstContext();
  decode.resolve(fakeBitmap(events));

  assert.equal(await first, firstOriginal);
  assert.notEqual(await queued, secondOriginal);
  assert.equal(contextIndex, 2);
  assert.ok(events.includes('offscreen-0:dispose'));
});

test('applyPreview loads the thumb LUT while applyToBlob defaults to full', async () => {
  const events: string[] = [];
  const loads: string[] = [];
  const engine = createLutEngineForTesting({
    createOffscreenCanvas: () => fakeCanvas(createFakeGl(events), events, 'offscreen'),
    createDomCanvas: () => null,
    decodeBlob: async () => fakeBitmap(events),
    loadFullLut: async () => {
      loads.push('full');
      return new Uint8Array(FULL_BYTES);
    },
    loadThumbLut: async () => {
      loads.push('thumb');
      return new Uint8Array(THUMB_BYTES);
    },
    logger: quietLogger,
  });

  await engine.applyPreview(
    new Blob(['preview'], { type: 'image/jpeg' }),
    { lutId: 'cloudy-cool', strength: 100 },
  );
  await engine.applyToBlob(
    new Blob(['full'], { type: 'image/jpeg' }),
    { lutId: 'cloudy-cool', strength: 100 },
  );
  assert.deepEqual(loads, ['thumb', 'full']);
});

function fakeCanvas(
  gl: WebGL2RenderingContext | null,
  events: string[],
  name: string,
  contextAttributes?: Array<WebGLContextAttributes | undefined>,
): LutCanvas {
  return {
    width: 1,
    height: 1,
    getContext(kind: 'webgl2', attributes?: WebGLContextAttributes) {
      events.push(`${name}:${kind}`);
      contextAttributes?.push(attributes);
      return gl;
    },
    async encode() {
      events.push(`${name}:encode`);
      return new Blob(['filtered'], { type: 'image/jpeg' });
    },
    dispose() {
      events.push(`${name}:dispose`);
    },
  };
}

function fakeBitmap(events: string[]) {
  return {
    width: 4,
    height: 3,
    close() {
      events.push('bitmap:close');
    },
  };
}

interface FakeGlOptions {
  failDraw?: boolean;
  shaderSources?: string[];
  compileResults?: readonly boolean[];
  linkResults?: readonly boolean[];
  missingUniformOnce?: string;
}

function createFakeGl(events: string[], options: FakeGlOptions = {}): WebGL2RenderingContext {
  type FakeShader = { source: string; compiled: boolean; deleted: boolean };
  type FakeProgram = { attached: FakeShader[]; linked: boolean; deleted: boolean };
  type FakeTexture = { kind: 'pending' | 'lut' | 'image'; uploaded: boolean; deleted: boolean };
  type FakeVao = { deleted: boolean };
  type FakeUniform = { name: string; program: FakeProgram };

  const compileResults = [...(options.compileResults ?? [])];
  const linkResults = [...(options.linkResults ?? [])];
  let missingUniform = options.missingUniformOnce;
  let currentProgram: FakeProgram | null = null;
  let currentVao: FakeVao | null = null;
  let bound2d: FakeTexture | null = null;
  let bound3d: FakeTexture | null = null;
  let cleared = false;

  function assertLiveProgram(program: FakeProgram): void {
    assert.equal(program.deleted, false, 'GL program must still be live');
  }

  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    TEXTURE_2D: 5,
    TEXTURE_3D: 6,
    TEXTURE_MIN_FILTER: 7,
    TEXTURE_MAG_FILTER: 8,
    TEXTURE_WRAP_S: 9,
    TEXTURE_WRAP_T: 10,
    TEXTURE_WRAP_R: 11,
    LINEAR: 12,
    CLAMP_TO_EDGE: 13,
    UNPACK_ALIGNMENT: 14,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 15,
    RGB8: 16,
    RGB: 17,
    UNSIGNED_BYTE: 18,
    RGBA: 19,
    TEXTURE0: 20,
    TEXTURE1: 21,
    COLOR_BUFFER_BIT: 22,
    TRIANGLES: 23,
    createShader: () => ({ source: '', compiled: false, deleted: false }),
    shaderSource: (shader: FakeShader, source: string) => {
      assert.equal(shader.deleted, false);
      shader.source = source;
      options.shaderSources?.push(source);
    },
    compileShader: (shader: FakeShader) => {
      assert.notEqual(shader.source, '', 'shader source must be installed before compile');
      shader.compiled = compileResults.shift() ?? true;
    },
    getShaderParameter: (shader: FakeShader, pname: number) => {
      assert.equal(pname, gl.COMPILE_STATUS);
      return shader.compiled;
    },
    getShaderInfoLog: () => '',
    deleteShader: (shader: FakeShader) => {
      shader.deleted = true;
    },
    createProgram: () => ({ attached: [], linked: false, deleted: false }),
    attachShader: (program: FakeProgram, shader: FakeShader) => {
      assertLiveProgram(program);
      assert.equal(shader.compiled, true, 'only compiled shaders may be attached');
      program.attached.push(shader);
    },
    linkProgram: (program: FakeProgram) => {
      assert.equal(program.attached.length, 2, 'vertex and fragment shaders must both be attached');
      program.linked = linkResults.shift() ?? true;
    },
    getProgramParameter: (program: FakeProgram, pname: number) => {
      assert.equal(pname, gl.LINK_STATUS);
      return program.linked;
    },
    getProgramInfoLog: () => '',
    deleteProgram: (program: FakeProgram) => {
      program.deleted = true;
      if (currentProgram === program) currentProgram = null;
    },
    useProgram: (program: FakeProgram) => {
      assertLiveProgram(program);
      assert.equal(program.linked, true);
      currentProgram = program;
    },
    getUniformLocation: (program: FakeProgram, name: string) => {
      assertLiveProgram(program);
      if (missingUniform === name) {
        missingUniform = undefined;
        return null;
      }
      return { name, program };
    },
    createVertexArray: () => ({ deleted: false }),
    deleteVertexArray: (vao: FakeVao) => {
      vao.deleted = true;
      if (currentVao === vao) currentVao = null;
    },
    bindVertexArray: (vao: FakeVao) => {
      assert.equal(vao.deleted, false);
      currentVao = vao;
    },
    createTexture: () => ({
      kind: 'pending' as const,
      uploaded: false,
      deleted: false,
    }),
    bindTexture: (target: number, texture: FakeTexture) => {
      assert.equal(texture.deleted, false);
      if (target === gl.TEXTURE_2D) bound2d = texture;
      else if (target === gl.TEXTURE_3D) bound3d = texture;
      else assert.fail(`unexpected texture target ${target}`);
    },
    texParameteri: (target: number) => {
      assert.ok(target === gl.TEXTURE_2D ? bound2d : bound3d, 'texture must be bound before parameters');
    },
    pixelStorei: (pname: number, value: number | boolean) => {
      const label = pname === gl.UNPACK_ALIGNMENT
        ? 'UNPACK_ALIGNMENT'
        : pname === gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL
          ? 'UNPACK_PREMULTIPLY_ALPHA_WEBGL'
          : String(pname);
      events.push(`pixelStorei:${label}:${String(value)}`);
    },
    texImage3D: (
      target: number,
      _level: number,
      _internal: number,
      width: number,
      height: number,
      depth: number,
      _border: number,
      _format: number,
      _type: number,
      data: Uint8Array,
    ) => {
      assert.equal(target, gl.TEXTURE_3D);
      assert.ok(bound3d);
      assert.equal(data.byteLength, width * height * depth * 3);
      bound3d.kind = 'lut';
      bound3d.uploaded = true;
    },
    texImage2D: () => {
      assert.ok(currentProgram, 'program must be active before image upload');
      assert.ok(currentVao, 'VAO must be active before image upload');
      assert.ok(bound2d);
      bound2d.kind = 'image';
      bound2d.uploaded = true;
    },
    viewport: (_x: number, _y: number, width: number, height: number) => {
      assert.ok(width > 0 && height > 0);
    },
    activeTexture: (unit: number) => {
      assert.ok(unit === gl.TEXTURE0 || unit === gl.TEXTURE1);
    },
    uniform1i: (location: FakeUniform) => {
      assert.equal(currentProgram, location.program);
    },
    uniform1f: (location: FakeUniform, value: number) => {
      assert.equal(currentProgram, location.program);
      events.push(`uniform1f:${location.name}:${value}`);
    },
    clear: (mask: number) => {
      assert.equal(mask, gl.COLOR_BUFFER_BIT);
      cleared = true;
    },
    drawArrays: () => {
      assert.ok(currentProgram);
      assert.ok(currentVao);
      assert.equal(bound2d?.uploaded, true);
      assert.equal(bound3d?.uploaded, true);
      assert.equal(cleared, true);
      events.push('draw');
      if (options.failDraw) throw new Error('draw failed');
    },
    deleteTexture: (texture: FakeTexture) => {
      texture.deleted = true;
      events.push(`texture:delete:${texture.kind}`);
    },
    isContextLost: () => false,
  };
  return gl as unknown as WebGL2RenderingContext;
}

const quietLogger = {
  error() {},
  warn() {},
};

function recordingLogger() {
  const errors: string[] = [];
  const warnings: string[] = [];
  return {
    errors,
    warnings,
    error(message?: unknown, ...params: unknown[]) {
      errors.push([message, ...params].map(errorText).join(' '));
    },
    warn(message?: unknown, ...params: unknown[]) {
      warnings.push([message, ...params].map(errorText).join(' '));
    },
  };
}

function errorText(value: unknown): string {
  return value instanceof Error ? `${value.message} ${String(value.cause ?? '')}` : String(value);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function gzipBody(data: Uint8Array): ArrayBuffer {
  return Uint8Array.from(gzipSync(data)).buffer;
}
