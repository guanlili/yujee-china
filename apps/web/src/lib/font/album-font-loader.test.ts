import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  clearAlbumFontLoadCacheForTests,
  loadAlbumFonts,
  type AlbumFontEnvironment,
} from './album-font-loader';

const pages = [{
  texts: {
    title: '春日记',
    'title#artFont': 'long-cang',
    'label#artFont': 'noto-serif-sc',
  },
}];

test('loadAlbumFonts memoizes an identical request and installs defaults plus art faces', async () => {
  clearAlbumFontLoadCacheForTests();
  let fetchCount = 0;
  let requestBody: unknown;
  const loaded: string[] = [];
  const installed: string[] = [];
  const unicodeRanges: string[] = [];
  const env: AlbumFontEnvironment = {
    fetchSubset: async (body) => {
      fetchCount += 1;
      requestBody = body;
      return {
        sansBase64: 'SANS',
        serifBase64: 'SERIF',
        artFonts: {
          'long-cang': { family: 'Long Cang', base64: 'LONG' },
          'noto-serif-sc': { family: 'NotoSerifSC', base64: 'SERIF' },
        },
      };
    },
    createFontFace: (family, source, descriptors) => {
      unicodeRanges.push(descriptors.unicodeRange);
      return ({
      family,
      source,
      async load() {
        loaded.push(`${family}:${source}`);
        return this;
      },
      });
    },
    addFontFace: (face) => installed.push(face.family),
    fontsReady: async () => undefined,
  };

  await Promise.all([loadAlbumFonts(pages, env), loadAlbumFonts(pages, env)]);
  await loadAlbumFonts(pages, env);

  assert.equal(fetchCount, 1);
  assert.deepEqual(
    (requestBody as { fontIds: string[] }).fontIds,
    ['long-cang', 'noto-serif-sc'],
  );
  assert.deepEqual(installed.sort(), ['Long Cang', 'Noto Sans SC', 'Noto Serif SC']);
  assert.equal(loaded.length, 3);
  assert.ok(loaded.some((item) => item.includes('base64,LONG')));
  assert.equal(unicodeRanges.length, 3);
  assert.ok(unicodeRanges.every((range) => range.includes('U+6625')));
});

test('loadAlbumFonts evicts failed requests so a later render can retry', async () => {
  clearAlbumFontLoadCacheForTests();
  let attempts = 0;
  const env: AlbumFontEnvironment = {
    fetchSubset: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('network down');
      return { sansBase64: 'S', serifBase64: 'R', artFonts: {} };
    },
    createFontFace: (family, source) => ({
      family,
      source,
      async load() { return this; },
    }),
    addFontFace: () => undefined,
    fontsReady: async () => undefined,
  };

  await assert.rejects(loadAlbumFonts(pages, env), /network down/);
  await loadAlbumFonts(pages, env);
  assert.equal(attempts, 2);
});

test('all browser render entrypoints request album fonts before final rendering', () => {
  const sources = {
    PagePreview: readFileSync(new URL('../../components/album/PagePreview.tsx', import.meta.url), 'utf8'),
    FlipBook: readFileSync(new URL('../../components/album/FlipBook.tsx', import.meta.url), 'utf8'),
    EditorPort: readFileSync(new URL('../../components/album/editor-v2/EditorPort.tsx', import.meta.url), 'utf8'),
    raster: readFileSync(new URL('../pdf/render-raster.ts', import.meta.url), 'utf8'),
  };

  assert.match(sources.PagePreview, /useAlbumFonts\(/);
  assert.match(sources.FlipBook, /useAlbumFonts\(/);
  assert.match(sources.EditorPort, /useAlbumFonts\(/);
  assert.match(
    sources.EditorPort,
    /page\.textsJson\s*=\s*\{ \.\.\.page\.textsJson, \[textKey\]: nextText \};[\s\S]{0,200}?ensureCurrentFonts\(\);/,
    'contenteditable commits must refresh the current subset',
  );
  assert.match(
    sources.EditorPort,
    /page\.textsJson\s*=\s*\{ \.\.\.page\.textsJson, \.\.\.r\.pageWrite\.texts \};\s*ensureCurrentFonts\(\);/,
    'draft pageWrite commits must refresh the current subset',
  );
  assert.match(sources.raster, /await loadAlbumFonts\(pages\)/);
});
