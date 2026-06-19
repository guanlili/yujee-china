import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApplyThemeAgentRequests } from './route-utils';
import type { V3ApplyThemeRequest } from '@yujee/contracts';

const BASE: V3ApplyThemeRequest = {
  albumId: 'alb_v3',
  language: 'en',
  theme: { subject: 'A Year Away', label: 'The Journey' },
  chapters: [
    { chapterId: 'c1', accentColor: '#C0392B', artFont: 'script-elegant' },
    { chapterId: 'c2', accentColor: '#1F618D', artFont: 'sans-modern' },
  ],
  pages: [
    { pageIndex: 0, templateId: 'mag-01', images: { hero: 'p0' }, texts: { title: 'Cover' } },
    { pageIndex: 1, templateId: 'mag-13', images: { image: 'p1' }, texts: { title: 'One' } },
    { pageIndex: 2, templateId: 'mag-13', images: { image: 'p2' }, texts: { title: 'Two' } },
    { pageIndex: 3, templateId: 'mag-20', images: {}, texts: { end: 'End' } },
  ],
};

test('buildApplyThemeAgentRequests splits multi-chapter pages into single-chapter agent payloads', () => {
  const requests = buildApplyThemeAgentRequests(BASE, {
    pages: [
      { pageIndex: 0, kind: 'cover', chapterId: null },
      { pageIndex: 1, kind: 'chapter', chapterId: 'c1' },
      { pageIndex: 2, kind: 'chapter', chapterId: 'c2' },
      { pageIndex: 3, kind: 'ending', chapterId: null },
    ],
  });

  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((req) => req.chapters.map((ch) => ch.chapterId)), [['c1'], ['c2']]);
  assert.deepEqual(requests.map((req) => req.pages.map((page) => page.pageIndex)), [[1], [2]]);
});

test('buildApplyThemeAgentRequests rejects a selected chapter with no related pages', () => {
  assert.throws(
    () =>
      buildApplyThemeAgentRequests(BASE, {
        pages: [
          { pageIndex: 1, kind: 'chapter', chapterId: 'c1' },
          { pageIndex: 2, kind: 'chapter', chapterId: 'c1' },
        ],
      }),
    /no related pages/,
  );
});

test('buildApplyThemeAgentRequests skips chapters whose related pages have no variableDecor slots', () => {
  const payload: V3ApplyThemeRequest = {
    ...BASE,
    pages: [
      { pageIndex: 1, templateId: 'mag-13', images: { image: 'p1' }, texts: { title: 'One' } },
      { pageIndex: 2, templateId: 'mag-06', images: { image: 'p2' }, texts: { body: 'Two' } },
    ],
  };

  const requests = buildApplyThemeAgentRequests(payload, {
    pages: [
      { pageIndex: 1, kind: 'chapter', chapterId: 'c1' },
      { pageIndex: 2, kind: 'chapter', chapterId: 'c2' },
    ],
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.chapters[0]!.chapterId, 'c1');
  assert.deepEqual(requests[0]!.pages.map((page) => page.pageIndex), [1]);
});
