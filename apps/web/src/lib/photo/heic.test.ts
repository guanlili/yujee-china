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
    join(srcRoot, 'components/album/editor-v2/EditorPort.tsx'),
  ];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /accept="image\/\*"/, `${file} must not use bare image/*`);
    assert.match(src, /IMAGE_INPUT_ACCEPT/, `${file} must use the shared HEIC-aware accept string`);
  }
});
