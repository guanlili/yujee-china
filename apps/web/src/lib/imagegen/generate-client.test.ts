import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generateImageIntoSlot } from './generate-client';

function deps(over: Partial<Parameters<typeof generateImageIntoSlot>[1]> = {}) {
  const calls: string[] = [];
  const base = {
    postGenerate: async () => {
      calls.push('generate');
      return { photoId: 'p1', generationId: 'g1', freeRetriesLeft: 1, charged: true };
    },
    fetchUrls: async (ids: string[]) => {
      calls.push(`urls:${ids.join(',')}`);
      return { p1: 'https://signed/p1' };
    },
    fetchBlob: async (url: string) => {
      calls.push(`blob:${url}`);
      return new Blob([new Uint8Array([1, 2, 3])]);
    },
    storeBlob: async (photoId: string) => {
      calls.push(`store:${photoId}`);
    },
    ...over,
  };
  return { deps: base, calls };
}

const REQ = { albumId: 'a1', prompt: '外婆的院子', width: 794, height: 1123 };

test('顺序必须是 生成 -> 取签名URL -> 下载 -> 落本地库', async () => {
  const { deps: d, calls } = deps();
  const out = await generateImageIntoSlot(REQ, d);
  assert.equal(out.photoId, 'p1');
  assert.deepEqual(calls, ['generate', 'urls:p1', 'blob:https://signed/p1', 'store:p1']);
});

test('必须落进本地库才算成功 —— 生成图的像素在 R2,不进本地库用户只会看到空框', async () => {
  const { deps: d } = deps({
    fetchUrls: async () => ({}),
  });
  await assert.rejects(generateImageIntoSlot(REQ, d), /no signed url/);
});

test('下载失败不落库,也不返回 photoId —— 半截状态会让图槽指向一张取不到的图', async () => {
  const stored: string[] = [];
  const { deps: d } = deps({
    fetchBlob: async () => {
      throw new Error('network down');
    },
    storeBlob: async (id: string) => {
      stored.push(id);
    },
  });
  await assert.rejects(generateImageIntoSlot(REQ, d));
  assert.deepEqual(stored, []);
});

test('把免费重来次数透出去,前端据此决定按钮文案', async () => {
  const { deps: d } = deps();
  const out = await generateImageIntoSlot(REQ, d);
  assert.equal(out.freeRetriesLeft, 1);
  assert.equal(out.generationId, 'g1');
});

test('重来时把 retryOf 带上去 —— 不带就会被当成新的一笔重新扣分', async () => {
  let sent: unknown = null;
  const { deps: d } = deps({
    postGenerate: async (body: unknown) => {
      sent = body;
      return { photoId: 'p1', generationId: 'g1', freeRetriesLeft: 0, charged: false };
    },
  });
  await generateImageIntoSlot({ ...REQ, retryOf: 'g1' }, d);
  assert.equal((sent as { retryOf?: string }).retryOf, 'g1');
});
