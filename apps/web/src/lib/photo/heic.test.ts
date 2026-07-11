import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { IMAGE_INPUT_ACCEPT, prepareImageBlobForBrowserDecode } from './heic';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..', '..');

test('prepareImageBlobForBrowserDecode leaves browser-decodable images unchanged', async () => {
  const jpeg = new Blob(['jpeg'], { type: 'image/jpeg' });
  let converted = false;

  const out = await prepareImageBlobForBrowserDecode(jpeg, async () => {
    converted = true;
    return new Blob(['converted'], { type: 'image/jpeg' });
  });

  assert.equal(out, jpeg);
  assert.equal(converted, false);
});

test('prepareImageBlobForBrowserDecode converts HEIC files even when MIME is empty', async () => {
  const heic = Object.assign(new Blob(['heic'], { type: '' }), { name: 'IMG_0007.HEIC' });
  const jpeg = new Blob(['jpeg'], { type: 'image/jpeg' });
  let seenInput: Blob | undefined;

  const out = await prepareImageBlobForBrowserDecode(heic, async (input) => {
    seenInput = input;
    return jpeg;
  });

  assert.equal(seenInput, heic);
  assert.equal(out, jpeg);
});

test('prepareImageBlobForBrowserDecode wraps non-Error HEIC conversion failures', async () => {
  await assert.rejects(
    () =>
      prepareImageBlobForBrowserDecode(new Blob(['heif'], { type: 'image/heif' }), async () => {
        throw new Event('error');
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /could not convert this HEIC\/HEIF image/i);
      assert.equal(err.message.includes('[object Event]'), false);
      return true;
    },
  );
});

test('photo file pickers explicitly accept HEIC/HEIF files', () => {
  assert.match(IMAGE_INPUT_ACCEPT, /image\/\*/);
  assert.match(IMAGE_INPUT_ACCEPT, /\.heic/);
  assert.match(IMAGE_INPUT_ACCEPT, /\.heif/);
  assert.match(IMAGE_INPUT_ACCEPT, /image\/heic/);
  assert.match(IMAGE_INPUT_ACCEPT, /image\/heif/);

  const files = [
    join(srcRoot, 'components/landing/HeroComposer.tsx'),
    join(srcRoot, 'app/[locale]/my-albums/page.tsx'),
    // 编辑器的中途加图 file input 随对话面板抽离到了 ChatPanel(重构);accept 仍用共享串。
    join(srcRoot, 'components/album/editor-v2/ChatPanel.tsx'),
  ];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /accept="image\/\*"/, `${file} must not use bare image/*`);
    assert.match(src, /IMAGE_INPUT_ACCEPT/, `${file} must use the shared HEIC-aware accept string`);
  }
});

test('prepareImageBlobForBrowserDecode rejects when the converter never settles (timeout guard)', async () => {
  const heic = new Blob(['heic'], { type: 'image/heic' });
  await assert.rejects(
    () =>
      prepareImageBlobForBrowserDecode(
        heic,
        () => new Promise<Blob>(() => {}), // 永不 resolve —— 模拟解码 wasm 挂死
        50,
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /could not convert this HEIC\/HEIF image/i);
      assert.match(err.message, /timed out/i);
      return true;
    },
  );
});

test('prepareImageBlobForBrowserDecode resolves normally well within the timeout', async () => {
  const heic = new Blob(['heic'], { type: 'image/heic' });
  const jpeg = new Blob(['jpeg'], { type: 'image/jpeg' });
  const out = await prepareImageBlobForBrowserDecode(heic, async () => jpeg, 5_000);
  assert.equal(out, jpeg);
});
