import assert from 'node:assert/strict';
import test from 'node:test';
import { basename } from 'node:path';

import { CJK_FONT_IDS, subsetFontSet } from './font-service';
import { CJK_FONT_MANIFEST } from './font-manifest';
import { FONT_CATALOG } from '@/components/album/templates/font-catalog';

test('CJK subset manifest is closed over the nine selectable Chinese fonts', () => {
  assert.deepEqual(CJK_FONT_IDS, [
    'noto-serif-sc',
    'noto-sans-sc',
    'zcool-xiaowei',
    'lxgw-wenkai',
    'smiley-sans',
    'zcool-qingke-huangyou',
    'long-cang',
    'zhi-mang-xing',
    'liu-jian-mao-cao',
  ]);
});

test('CJK manifest names match the actual Web stack and PDF catalog family', () => {
  for (const id of CJK_FONT_IDS) {
    const entry = FONT_CATALOG[id];
    const webPrimary = entry.webFontFamily.match(/^"([^"]+)"/)?.[1];
    assert.equal(CJK_FONT_MANIFEST[id].webFamily, webPrimary, `${id} Web family`);
    assert.equal(CJK_FONT_MANIFEST[id].pdfFamily, entry.pdfFontFamily, `${id} PDF family`);
  }
});

test('subsetFontSet cuts defaults plus unique requested fonts and reuses Noto bytes', async () => {
  const calls: string[] = [];
  const fakeSubset = async (fontPath: string, charset: string) => {
    assert.equal(charset, '遇己 Album');
    calls.push(basename(fontPath));
    return Buffer.from(basename(fontPath));
  };

  const result = await subsetFontSet(
    '遇己 Album',
    ['long-cang', 'noto-serif-sc', 'long-cang'],
    fakeSubset,
  );

  assert.deepEqual(calls.sort(), [
    'LongCang-Regular.ttf',
    'NotoSansSC-Regular.ttf',
    'NotoSerifSC-Regular.ttf',
  ]);
  assert.equal(result.sans.toString(), 'NotoSansSC-Regular.ttf');
  assert.equal(result.serif.toString(), 'NotoSerifSC-Regular.ttf');
  assert.deepEqual(Object.keys(result.artFonts), ['long-cang', 'noto-serif-sc']);
  assert.equal(result.artFonts['long-cang']?.family, 'Long Cang');
  assert.equal(result.artFonts['long-cang']?.bytes.toString(), 'LongCang-Regular.ttf');
  assert.equal(result.artFonts['noto-serif-sc']?.bytes, result.serif);
});

test('subsetFontSet rejects unknown or over-limit requests before reading fonts', async () => {
  const never = async () => {
    assert.fail('invalid requests must not read or subset fonts');
  };

  await assert.rejects(
    subsetFontSet('字', ['comic-sans'] as never[], never),
    /unknown CJK font id/,
  );
  await assert.rejects(
    subsetFontSet('字', ['long-cang', 'smiley-sans', 'lxgw-wenkai', 'zhi-mang-xing'], never),
    /at most 3/,
  );
});
