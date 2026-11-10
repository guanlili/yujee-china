import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetKeyFromUrl, assetProxyPath, normalizeAssetUrl } from './asset-url';

test('assetProxyPath 只拼相对代理路径,不带存储域名', () => {
  assert.equal(assetProxyPath('pdfs/a/b.pdf'), '/api/v1/assets/pdfs/a/b.pdf');
});

test('normalizeAssetUrl 把历史裸存储地址改写成代理路径', () => {
  const bare = 'https://yujee-1324377593.cos.ap-beijing.myqcloud.com/photo-snapshots/u/a/p/pf-v1__original.jpg';
  assert.equal(
    normalizeAssetUrl(bare),
    '/api/v1/assets/photo-snapshots/u/a/p/pf-v1__original.jpg',
  );
});

test('normalizeAssetUrl 对已是代理路径的入参幂等,空值返回 null', () => {
  const proxy = '/api/v1/assets/cover-thumbs/u/a/1.jpg';
  assert.equal(normalizeAssetUrl(proxy), proxy);
  assert.equal(normalizeAssetUrl(null), null);
  assert.equal(normalizeAssetUrl(undefined), null);
});

test('assetKeyFromUrl 能从两种形态里取出同一个 key', () => {
  const key = 'photo-snapshots/u/a/p/pf-v1__original.jpg';
  assert.equal(assetKeyFromUrl(`https://cdn.example.com/${key}`), key);
  assert.equal(assetKeyFromUrl(assetProxyPath(key)), key);
});
