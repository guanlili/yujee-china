import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyzeDraftJson } from './job-service';

const TREE = {
  chapters: [
    {
      chapterId: 'ch_1',
      description: 'A quiet morning.',
      extractedColor: '#112233',
      accentColor: null,
      artFont: null,
      photos: [],
    },
  ],
};

const PAGES = [{ pageIndex: 0, templateId: 'mag-02', images: { image: 'p1' }, texts: {} }];

test('buildAnalyzeDraftJson wraps tree-only analyze output as V3StoryDraft', () => {
  assert.deepEqual(buildAnalyzeDraftJson(TREE, undefined), {
    version: 'v3-story',
    tree: TREE,
    progress: { currentChapterId: 'ch_1', doneChapterIds: [] },
  });
});

test('buildAnalyzeDraftJson preserves legacy pages callbacks during migration', () => {
  assert.deepEqual(buildAnalyzeDraftJson(TREE, PAGES), { ...TREE, pages: PAGES });
});
