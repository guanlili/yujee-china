import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveGenerationStageLabel } from './AlbumGeneratingShell';

describe('resolveGenerationStageLabel', () => {
  const stage = {
    vision: 'AI is looking at your photos...',
    writing: 'AI is writing your story...',
    composing: 'AI is laying out the pages...',
    starting: 'Starting...',
  };

  it('uses localized editor stage labels when the stage is known', () => {
    assert.equal(resolveGenerationStageLabel('writing', stage), 'AI is writing your story...');
  });

  it('falls back to raw backend stages when no localized label exists', () => {
    assert.equal(resolveGenerationStageLabel('cover-design', stage), 'cover-design');
  });

  it('uses the starting label when no stage has arrived yet', () => {
    assert.equal(resolveGenerationStageLabel(null, stage), 'Starting...');
    assert.equal(resolveGenerationStageLabel(undefined, stage), 'Starting...');
  });
});
