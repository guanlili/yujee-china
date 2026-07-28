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
    logger: quietLogger,
  });
  const original = new Blob(['original'], { type: 'image/jpeg' });

  assert.equal(engine.isSupported(), false);
  assert.equal(await engine.applyToBlob(original, { lutId: 'cloudy-cool', strength: 100 }, 'full'), original);
  assert.equal(await engine.applyToBlob(original, { lutId: 'cloudy-cool', strength: 0 }, 'full'), original);
  assert.equal(decodeCalls, 0);
  assert.equal(loadCalls, 0);
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
  const engine = createLutEngineForTesting({
    createOffscreenCanvas: () => fakeCanvas(gl, events, 'offscreen'),
    createDomCanvas: () => null,
    decodeBlob: async () => bitmap,
    loadFullLut: async () => {
      events.push('lut:load');
      throw new Error('resource unavailable');
    },
    loadThumbLut: async () => new Uint8Array(THUMB_BYTES),
    logger: quietLogger,
  });
  const original = new Blob(['original'], { type: 'image/jpeg' });

  assert.equal(await engine.applyToBlob(original, { lutId: 'cloudy-cool', strength: 100 }, 'full'), original);
  assert.ok(events.includes('bitmap:close'));
});

test('render failure returns original, deletes the per-image texture, and closes the bitmap', async () => {
  const events: string[] = [];
  const bitmap = fakeBitmap(events);
  const gl = createFakeGl(events, { failDraw: true });
  const engine = createLutEngineForTesting({
    createOffscreenCanvas: () => fakeCanvas(gl, events, 'offscreen'),
    createDomCanvas: () => null,
    decodeBlob: async () => bitmap,
    loadFullLut: async () => new Uint8Array(FULL_BYTES),
    loadThumbLut: async () => new Uint8Array(THUMB_BYTES),
    logger: quietLogger,
  });
  const original = new Blob(['original'], { type: 'image/jpeg' });

  assert.equal(await engine.applyToBlob(original, { lutId: 'cloudy-cool', strength: 100 }, 'full'), original);
  assert.ok(events.includes('texture:delete:image'));
  assert.ok(events.includes('bitmap:close'));
});

test('encode failure returns original after deleting the image texture and closing the bitmap', async () => {
  const events: string[] = [];
  const bitmap = fakeBitmap(events);
  const gl = createFakeGl(events);
  const canvas = fakeCanvas(gl, events, 'offscreen');
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
    logger: quietLogger,
  });
  const original = new Blob(['original'], { type: 'image/jpeg' });

  assert.equal(await engine.applyToBlob(original, { lutId: 'cloudy-cool', strength: 100 }, 'full'), original);
  assert.ok(events.includes('offscreen:encode'));
  assert.ok(events.includes('texture:delete:image'));
  assert.ok(events.includes('bitmap:close'));
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

function fakeCanvas(
  gl: WebGL2RenderingContext | null,
  events: string[],
  name: string,
): LutCanvas {
  return {
    width: 1,
    height: 1,
    getContext(kind: 'webgl2') {
      events.push(`${name}:${kind}`);
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

function createFakeGl(events: string[], options: { failDraw?: boolean } = {}): WebGL2RenderingContext {
  let textureCount = 0;
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
    RGB8: 15,
    RGB: 16,
    UNSIGNED_BYTE: 17,
    RGBA: 18,
    TEXTURE0: 19,
    TEXTURE1: 20,
    COLOR_BUFFER_BIT: 21,
    TRIANGLES: 22,
    createShader: () => ({}),
    shaderSource: () => undefined,
    compileShader: () => undefined,
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    deleteShader: () => undefined,
    createProgram: () => ({}),
    attachShader: () => undefined,
    linkProgram: () => undefined,
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    deleteProgram: () => undefined,
    useProgram: () => undefined,
    getUniformLocation: (_program: unknown, name: string) => ({ name }),
    createVertexArray: () => ({}),
    deleteVertexArray: () => undefined,
    bindVertexArray: () => undefined,
    createTexture: () => {
      textureCount += 1;
      return { kind: textureCount === 1 ? 'lut' : 'image' };
    },
    bindTexture: () => undefined,
    texParameteri: () => undefined,
    pixelStorei: () => undefined,
    texImage3D: () => undefined,
    texImage2D: () => undefined,
    viewport: () => undefined,
    activeTexture: () => undefined,
    uniform1i: () => undefined,
    uniform1f: () => undefined,
    clear: () => undefined,
    drawArrays: () => {
      events.push('draw');
      if (options.failDraw) throw new Error('draw failed');
    },
    deleteTexture: (texture: { kind: string }) => {
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

function gzipBody(data: Uint8Array): ArrayBuffer {
  return Uint8Array.from(gzipSync(data)).buffer;
}
