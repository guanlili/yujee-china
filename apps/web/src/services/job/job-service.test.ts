import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyzeDraftJson, mergeSelectLayoutPages } from './job-service';

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
  assert.deepEqual(buildAnalyzeDraftJson(TREE), {
    version: 'v3-story',
    tree: TREE,
    progress: { currentChapterId: 'ch_1', doneChapterIds: [] },
  });
});

test('mergeSelectLayoutPages adds pages without mutating the Stage1 tree/progress', () => {
  const draft = buildAnalyzeDraftJson(TREE);

  assert.deepEqual(mergeSelectLayoutPages(draft, PAGES), {
    version: 'v3-story',
    tree: TREE,
    pages: PAGES,
    progress: { currentChapterId: 'ch_1', doneChapterIds: [] },
  });
  assert.deepEqual(draft, {
    version: 'v3-story',
    tree: TREE,
    progress: { currentChapterId: 'ch_1', doneChapterIds: [] },
  });
});
