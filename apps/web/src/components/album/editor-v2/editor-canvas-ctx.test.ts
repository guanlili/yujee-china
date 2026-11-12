// 阶段 1 的纯函数:直接用断言锁住语义,保证「搬出来」不是「改坏了」。
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { countSpreads, findPageByIndex } from './editor-canvas-ctx';
import type { EditorPage } from '../types';

const page = (pageIndex: number): EditorPage =>
  ({ pageIndex, templateId: 't', imagesJson: {}, textsJson: {} }) as unknown as EditorPage;

describe('findPageByIndex', () => {
  it('按 pageIndex 命中,不是按数组下标', () => {
    const pages = [page(2), page(0), page(5)];
    assert.equal(findPageByIndex(pages, 2)?.pageIndex, 2);
    assert.equal(findPageByIndex(pages, 0)?.pageIndex, 0);
    assert.equal(findPageByIndex(pages, 5)?.pageIndex, 5);
  });

  it('不存在返回 undefined(调用方本来就按 undefined 处理)', () => {
    assert.equal(findPageByIndex([page(0)], 9), undefined);
  });
});

describe('countSpreads', () => {
  it('空书也给 1(画布不能退化成 0 页)', () => {
    assert.equal(countSpreads([]), 1);
    assert.equal(countSpreads({ length: 0 }), 1);
  });

  it('非空按实际数量', () => {
    assert.equal(countSpreads([1, 2, 3]), 3);
    assert.equal(countSpreads({ length: 7 }), 7);
  });
});
