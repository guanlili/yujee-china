import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoverThumbnailJpeg, COVER_THUMBNAIL_HEIGHT, COVER_THUMBNAIL_WIDTH } from './cover-thumbnail';

test('cover thumbnail generation creates a bounded 640x480 JPEG derivative', async () => {
  const restore = installBrowserImageMocks({
    imageWidth: 1200,
    imageHeight: 900,
    blobSizes: [42 * 1024],
  });
  try {
    const blob = await createCoverThumbnailJpeg(new Blob(['original'], { type: 'image/png' }));

    assert.equal(COVER_THUMBNAIL_WIDTH, 640);
    assert.equal(COVER_THUMBNAIL_HEIGHT, 480);
    assert.equal(blob.type, 'image/jpeg');
    assert.equal(blob.size, 42 * 1024);
    assert.equal(restore.canvases[0]?.width, 0);
    assert.equal(restore.canvases[0]?.height, 0);
    assert.deepEqual(restore.imageBitmapOptions, [{ imageOrientation: 'from-image' }]);
    assert.deepEqual(restore.order, ['decode', 'fillRect', 'drawImage', 'toBlob:0.82', 'close']);
    assert.deepEqual(restore.draws[0], {
      sx: 0,
      sy: 0,
      sw: 1200,
      sh: 900,
      dx: 0,
      dy: 0,
      dw: 640,
      dh: 480,
    });
  } finally {
    restore();
  }
});

test('cover thumbnail generation retries lower quality when the first JPEG is too large', async () => {
  const restore = installBrowserImageMocks({
    imageWidth: 900,
    imageHeight: 1200,
    blobSizes: [700 * 1024, 320 * 1024],
  });
  try {
    const blob = await createCoverThumbnailJpeg(new Blob(['original'], { type: 'image/jpeg' }));

    assert.equal(blob.size, 320 * 1024);
    assert.deepEqual(restore.order, [
      'decode',
      'fillRect',
      'drawImage',
      'toBlob:0.82',
      'toBlob:0.72',
      'close',
    ]);
    assert.deepEqual(restore.draws[0], {
      sx: 0,
      sy: 262.5,
      sw: 900,
      sh: 675,
      dx: 0,
      dy: 0,
      dw: 640,
      dh: 480,
    });
  } finally {
    restore();
  }
});

test('cover thumbnail generation fails clearly when canvas context is unavailable', async () => {
  const restore = installBrowserImageMocks({
    imageWidth: 640,
    imageHeight: 480,
    blobSizes: [16 * 1024],
    contextUnavailable: true,
  });
  try {
    await assert.rejects(
      createCoverThumbnailJpeg(new Blob(['x'], { type: 'image/jpeg' })),
      /cover thumbnail canvas context unavailable/,
    );
    assert.deepEqual(restore.order, ['decode', 'close']);
  } finally {
    restore();
  }
});

interface DrawCall {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

interface MockCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): unknown;
  toBlob(callback: (blob: Blob | null) => void, type: string, quality?: number): void;
}

function installBrowserImageMocks({
  imageWidth,
  imageHeight,
  blobSizes,
  contextUnavailable = false,
}: {
  imageWidth: number;
  imageHeight: number;
  blobSizes: number[];
  contextUnavailable?: boolean;
}): (() => void) & {
  canvases: MockCanvas[];
  draws: DrawCall[];
  imageBitmapOptions: unknown[];
  order: string[];
} {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const hadCreateImageBitmap = 'createImageBitmap' in globalThis;
  const hadDocument = 'document' in globalThis;
  const canvases: MockCanvas[] = [];
  const draws: DrawCall[] = [];
  const imageBitmapOptions: unknown[] = [];
  const order: string[] = [];
  let blobIndex = 0;

  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async (_blob: Blob, options?: unknown) => {
      imageBitmapOptions.push(options);
      order.push('decode');
      return {
        width: imageWidth,
        height: imageHeight,
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
          getContext: () => {
            if (contextUnavailable) return null;
            return {
              fillStyle: '',
              fillRect: () => order.push('fillRect'),
              drawImage: (
                _img: CanvasImageSource,
                sx: number,
                sy: number,
                sw: number,
                sh: number,
                dx: number,
                dy: number,
                dw: number,
                dh: number,
              ) => {
                order.push('drawImage');
                draws.push({ sx, sy, sw, sh, dx, dy, dw, dh });
              },
            };
          },
          toBlob: (callback, type, quality) => {
            assert.equal(type, 'image/jpeg');
            order.push(`toBlob:${quality}`);
            const size = blobSizes[Math.min(blobIndex, blobSizes.length - 1)] ?? 1;
            blobIndex += 1;
            callback(new Blob([new Uint8Array(size)], { type }));
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
    draws: DrawCall[];
    imageBitmapOptions: unknown[];
    order: string[];
  };
  restore.canvases = canvases;
  restore.draws = draws;
  restore.imageBitmapOptions = imageBitmapOptions;
  restore.order = order;
  return restore;
}
