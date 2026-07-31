import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

test('共用小水母素材裁掉左侧 7px 白边,并保留 RGBA 透明通道', () => {
  const png = readFileSync(join(process.cwd(), 'public', 'jellyfish-icon.png'));

  assert.equal(png.toString('ascii', 1, 4), 'PNG', '素材必须保持 PNG');
  assert.equal(png.readUInt32BE(16), 171, '左侧 7px 白边应从原 178px 画布裁掉');
  assert.equal(png.readUInt32BE(20), 178, '只裁左边,不改变水母高度');
  assert.equal(png[25], 6, '素材必须保持 RGBA,不能把透明背景烘成白底');
});
