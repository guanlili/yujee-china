import { test } from 'node:test';
import assert from 'node:assert/strict';

const { transientPagePhotoRefs } = await import('./page-photo-refs');

// 这个模块是 process-local 的请求窗口缓存:register → get → clear。
// 关键不变量:①两个入参形状等价 ②读写按 (albumId, chapterId) 隔离
// ③get 返回副本(调用方改不坏内部状态) ④注册空集合等于清空该窗口。

test('record 与数组两种入参写入同一份 refs', () => {
  transientPagePhotoRefs.resetForTest();
  transientPagePhotoRefs.register({
    albumId: 'a1',
    chapterId: 'c1',
    refs: { p1: 'data:image/jpeg;base64,AAA', p2: 'data:image/jpeg;base64,BBB' },
  });
  const fromRecord = transientPagePhotoRefs.get('a1', 'c1');
  assert.equal(fromRecord.get('p1'), 'data:image/jpeg;base64,AAA');
  assert.equal(fromRecord.size, 2);

  transientPagePhotoRefs.register({
    albumId: 'a1',
    chapterId: 'c1',
    refs: [
      { photoId: 'p1', ref200px: 'data:image/jpeg;base64,AAA' },
      { photoId: 'p2', ref200px: 'data:image/jpeg;base64,BBB' },
    ],
  });
  const fromArray = transientPagePhotoRefs.get('a1', 'c1');
  assert.deepEqual([...fromArray.entries()].sort(), [...fromRecord.entries()].sort());
});

test('(albumId, chapterId) 隔离：一个窗口覆盖不了另一个', () => {
  transientPagePhotoRefs.resetForTest();
  transientPagePhotoRefs.register({ albumId: 'a1', chapterId: 'c1', refs: { p1: 'x' } });
  transientPagePhotoRefs.register({ albumId: 'a1', chapterId: 'c2', refs: { p1: 'y' } });
  transientPagePhotoRefs.register({ albumId: 'a2', chapterId: 'c1', refs: { p1: 'z' } });

  assert.equal(transientPagePhotoRefs.get('a1', 'c1').get('p1'), 'x');
  assert.equal(transientPagePhotoRefs.get('a1', 'c2').get('p1'), 'y');
  assert.equal(transientPagePhotoRefs.get('a2', 'c1').get('p1'), 'z');
});

test('get 返回副本：调用方删条目不影响已存的窗口', () => {
  transientPagePhotoRefs.resetForTest();
  transientPagePhotoRefs.register({ albumId: 'a1', chapterId: 'c1', refs: { p1: 'x', p2: 'y' } });
  const copy = transientPagePhotoRefs.get('a1', 'c1') as Map<string, string>;
  copy.delete('p1');
  assert.equal(transientPagePhotoRefs.get('a1', 'c1').size, 2);
});

test('未注册过的窗口读到空集合，不抛异常', () => {
  transientPagePhotoRefs.resetForTest();
  const empty = transientPagePhotoRefs.get('nope', 'nope');
  assert.equal(empty.size, 0);
});

test('注册空集合等价于清空该窗口；clear 后再读为空', () => {
  transientPagePhotoRefs.resetForTest();
  transientPagePhotoRefs.register({ albumId: 'a1', chapterId: 'c1', refs: { p1: 'x' } });
  transientPagePhotoRefs.register({ albumId: 'a1', chapterId: 'c1', refs: {} });
  assert.equal(transientPagePhotoRefs.get('a1', 'c1').size, 0);

  transientPagePhotoRefs.register({ albumId: 'a1', chapterId: 'c1', refs: { p1: 'x' } });
  transientPagePhotoRefs.clear('a1', 'c1');
  assert.equal(transientPagePhotoRefs.get('a1', 'c1').size, 0);
  // 清空 c1 不影响同相册其他章节
  transientPagePhotoRefs.register({ albumId: 'a1', chapterId: 'c2', refs: { p9: 'keep' } });
  assert.equal(transientPagePhotoRefs.get('a1', 'c2').get('p9'), 'keep');
});
