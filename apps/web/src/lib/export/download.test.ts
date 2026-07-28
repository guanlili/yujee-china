import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createZipBlob } from './download';

test('createZipBlob packages the still cover and motion with UTF-8 filenames', async () => {
  const zip = await createZipBlob([
    { name: '相册-cover.jpg', blob: new Blob(['cover'], { type: 'image/jpeg' }) },
    { name: '相册-motion.mp4', blob: new Blob(['video'], { type: 'video/mp4' }) },
  ]);
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const text = new TextDecoder().decode(bytes);

  assert.equal(zip.type, 'application/zip');
  assert.equal(view.getUint32(0, true), 0x04034b50, 'zip should start with a local file header');
  assert.equal(view.getUint32(bytes.byteLength - 22, true), 0x06054b50, 'zip should end with a central-directory record');
  assert.match(text, /相册-cover\.jpg/);
  assert.match(text, /相册-motion\.mp4/);
});
