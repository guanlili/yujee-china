import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { photoStore } from './store';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..', '..');

test('PDF export image sizing caps long edge and never upscales', async () => {
  const storeSrc = readFileSync(join(here, 'store.ts'), 'utf8');
  assert.match(storeSrc, /export const PDF_IMAGE_MAX_EDGE = 1600/);
  assert.match(storeSrc, /export function fitWithinMaxEdge/);

  const { fitWithinMaxEdge, PDF_IMAGE_MAX_EDGE } = await import('./store');
  assert.equal(PDF_IMAGE_MAX_EDGE, 1600);
  assert.deepEqual(fitWithinMaxEdge(4000, 3000), { w: 1600, h: 1200 });
  assert.deepEqual(fitWithinMaxEdge(1200, 2400), { w: 800, h: 1600 });
  assert.deepEqual(fitWithinMaxEdge(1200, 900), { w: 1200, h: 900 });
});

test('PDF export uses bounded PDF data URLs, not raw original data URLs', () => {
  const editorPort = readFileSync(
    join(srcRoot, 'components/album/editor-v2/EditorPort.tsx'),
    'utf8',
  );

  // 栅格导出（html2canvas 高倍截图）需要更高的上限,但仍必须走有界的
  // getPdfDataUrls 通道,绝不直接喂原图 data URL。
  assert.match(
    editorPort,
    /photoStore\.getPdfDataUrls\(ids, RASTER_PDF_IMAGE_MAX_EDGE\)/,
    'EditorPort must use PDF-sized images',
  );
  assert.doesNotMatch(
    editorPort,
    /photoStore\.getDataUrls\(ids\)/,
    'EditorPort must not export raw originals',
  );
});

test('photoStore prepares HEIC originals before browser preview and export decode', () => {
  const storeSrc = readFileSync(join(here, 'store.ts'), 'utf8');

  assert.match(storeSrc, /prepareImageBlobForBrowserDecode/);
  assert.match(storeSrc, /const displayBlob = await prepareImageBlobForBrowserDecode\(blob\)/);
  assert.match(storeSrc, /const pdfBlob = await prepareImageBlobForBrowserDecode\(blob\)/);
});

test('PDF export checks both HTTP and JSON success before accepting cloud confirm', () => {
  const editorPort = readFileSync(
    join(srcRoot, 'components/album/editor-v2/EditorPort.tsx'),
    'utf8',
  );

  assert.match(editorPort, /if \(!confirmRes\.ok \|\| confirmJson\.ok !== true\)/);
});

test('PDF export does not trigger cover thumbnail generation from editor flows', () => {
  const editorPort = readFileSync(
    join(srcRoot, 'components/album/editor-v2/EditorPort.tsx'),
    'utf8',
  );

  assert.doesNotMatch(editorPort, /uploadCoverThumbnail/);
});

test('PDF export data URLs honor EXIF orientation and release image/canvas buffers', async () => {
  const restore = installBrowserImageMocks({
    contextFactory: () => ({
      fillStyle: '',
      fillRect() {},
      drawImage() {},
    }),
  });
  try {
    const store = Object.create(photoStore) as typeof photoStore;
    store.getBlob = async (id: string) => {
      restore.order.push(`get:${id}`);
      return new Blob([id], { type: 'image/jpeg' });
    };

    const out = await store.getPdfDataUrls(['a', 'b']);

    assert.deepEqual(out, {
      a: 'data:image/jpeg;1600x1200',
      b: 'data:image/jpeg;1600x1200',
    });
    assert.deepEqual(restore.order, ['get:a', 'decode', 'toDataURL', 'close', 'get:b', 'decode', 'toDataURL', 'close']);
    assert.deepEqual(restore.imageBitmapOptions, [
      { imageOrientation: 'from-image' },
      { imageOrientation: 'from-image' },
    ]);
    assert.equal(restore.canvases.length, 2);
    for (const canvas of restore.canvases) {
      assert.equal(canvas.width, 0);
      assert.equal(canvas.height, 0);
    }
  } finally {
    restore();
  }
});

test('PDF export data URL generation fails clearly when canvas context is unavailable', async () => {
  const restore = installBrowserImageMocks({ contextFactory: () => null });
  try {
    const store = Object.create(photoStore) as typeof photoStore;
    store.getBlob = async () => new Blob(['x'], { type: 'image/jpeg' });

    await assert.rejects(
      store.getPdfDataUrls(['bad']),
      /PDF image canvas context unavailable/,
    );
    assert.deepEqual(restore.order, ['decode', 'close']);
    assert.equal(restore.canvases[0]?.width, 0);
    assert.equal(restore.canvases[0]?.height, 0);
  } finally {
    restore();
  }
});

test('PDF export fallback decode wraps Image error events', async () => {
  const restore = installBrokenImageFallbackMocks();
  try {
    const store = Object.create(photoStore) as typeof photoStore;
    store.getBlob = async () => new Blob(['x'], { type: 'image/jpeg' });

    await assert.rejects(
      store.getPdfDataUrls(['bad']),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /could not decode stored photo image/i);
        assert.equal(err.message.includes('[object Event]'), false);
        return true;
      },
    );
  } finally {
    restore();
  }
});

interface MockCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): unknown;
  toDataURL(type: string, quality?: number): string;
}

function installBrokenImageFallbackMocks(): () => void {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalImage = globalThis.Image;
  const hadCreateImageBitmap = 'createImageBitmap' in globalThis;
  const hadImage = 'Image' in globalThis;

  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async () => {
      throw new Error('bitmap decode failed');
    },
  });
  Object.defineProperty(globalThis, 'Image', {
    configurable: true,
    value: class BrokenImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    },
  });

  return () => {
    if (hadCreateImageBitmap) {
      Object.defineProperty(globalThis, 'createImageBitmap', {
        configurable: true,
        value: originalCreateImageBitmap,
      });
    } else {
      delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
    }
    if (hadImage) {
      Object.defineProperty(globalThis, 'Image', {
        configurable: true,
        value: originalImage,
      });
    } else {
      delete (globalThis as { Image?: unknown }).Image;
    }
  };
}

function installBrowserImageMocks({
  contextFactory,
}: {
  contextFactory: () => unknown;
}): (() => void) & {
  canvases: MockCanvas[];
  imageBitmapOptions: unknown[];
  order: string[];
} {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const hadCreateImageBitmap = 'createImageBitmap' in globalThis;
  const hadDocument = 'document' in globalThis;
  const canvases: MockCanvas[] = [];
  const imageBitmapOptions: unknown[] = [];
  const order: string[] = [];

  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async (_blob: Blob, options?: unknown) => {
      imageBitmapOptions.push(options);
      order.push('decode');
      return {
        width: 4000,
        height: 3000,
        close: () => order.push('close'),
      };
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: (tag: string) => {
        assert.equal(tag, 'canvas');
        const canvas: MockCanvas = {
          width: 0,
          height: 0,
          getContext: () => contextFactory(),
          toDataURL: (type: string, quality?: number) => {
            assert.equal(type, 'image/jpeg');
            assert.equal(quality, 0.82);
            order.push('toDataURL');
            return `data:image/jpeg;${canvas.width}x${canvas.height}`;
          },
        };
        canvases.push(canvas);
        return canvas;
      },
    },
  });

  const restore = (() => {
    if (hadCreateImageBitmap) {
      Object.defineProperty(globalThis, 'createImageBitmap', {
        configurable: true,
        value: originalCreateImageBitmap,
      });
    } else {
      delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
    }
    if (hadDocument) {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: originalDocument,
      });
    } else {
      delete (globalThis as { document?: unknown }).document;
    }
  }) as (() => void) & {
    canvases: MockCanvas[];
    imageBitmapOptions: unknown[];
    order: string[];
  };
  restore.canvases = canvases;
  restore.imageBitmapOptions = imageBitmapOptions;
  restore.order = order;
  return restore;
}
