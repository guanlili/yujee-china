import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyzeDraftJson, mergeSelectLayoutPages, mergeV3Usage } from './job-service';

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

test('mergeSelectLayoutPages rejects select-layout output before a Stage1 tree exists', () => {
  assert.throws(
    () => mergeSelectLayoutPages({ chapters: [] }, PAGES),
    /select-layout completion requires an existing v3-story draft/,
  );
  assert.throws(
    () => mergeSelectLayoutPages(null, PAGES),
    /select-layout completion requires an existing v3-story draft/,
  );
});

test('mergeV3Usage keeps Stage1 usage when Stage2 reuses the same job', () => {
  assert.deepEqual(
    mergeV3Usage(
      {
        durationMs: 10,
        visionCallCount: 2,
        planningInputTokens: 3,
        models: { vision: 'doubao' },
      },
      {
        durationMs: 20,
        geminiCallCount: 1,
        planningInputTokens: 7,
        planningOutputTokens: 11,
        models: { planning: 'gemini-layout' },
      },
    ),
    {
      durationMs: 30,
      visionCallCount: 2,
      geminiCallCount: 1,
      planningInputTokens: 10,
      planningOutputTokens: 11,
      repairAttempts: 0,
      models: { vision: 'doubao', planning: 'gemini-layout' },
    },
  );
});
