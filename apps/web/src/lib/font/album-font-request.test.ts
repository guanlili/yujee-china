import assert from 'node:assert/strict';
import test from 'node:test';

import { collectAlbumFontRequest } from './album-font-request';

test('collectAlbumFontRequest gathers visible text and only explicit CJK carriers', () => {
  const request = collectAlbumFontRequest([
    {
      templateId: 'mag-01',
      images: {},
      texts: {
        title: '春日 Album',
        'title#artFont': 'long-cang',
        'title#accentColor': '#123456',
        body: '一段正文',
        'body#artFont': 'inter',
      },
    },
    {
      templateId: 'mag-02',
      images: {},
      texts: {
        'title[0]': '再见',
        'title[0]#artFont': 'long-cang',
        'number[0]#artFont': 'smiley-sans',
      },
    },
  ]);

  for (const char of '春日 Album一段正文') {
    assert.ok(request.charset.includes(char), `charset must include ${char}`);
  }
  assert.doesNotMatch(request.charset, /long-cang|#123456|inter/);
  assert.deepEqual(request.fontIds, ['long-cang', 'smiley-sans']);
});

test('collectAlbumFontRequest caps art families at the endpoint limit', () => {
  const request = collectAlbumFontRequest([{
    templateId: 'mag-01',
    images: {},
    texts: {
      'a#artFont': 'long-cang',
      'b#artFont': 'smiley-sans',
      'c#artFont': 'lxgw-wenkai',
      'd#artFont': 'zhi-mang-xing',
    },
  }]);

  assert.deepEqual(request.fontIds, ['long-cang', 'smiley-sans', 'lxgw-wenkai']);
});
