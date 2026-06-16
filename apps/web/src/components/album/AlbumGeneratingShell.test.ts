import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveGenerationStageLabel } from './AlbumGeneratingShell';

describe('resolveGenerationStageLabel', () => {
  const stage = {
    vision: 'Looking at your photos…',
    grouping: 'Grouping your moments…',
    skeleton: 'Laying out the spreads…',
    finalize: 'Putting the final touches…',
    starting: 'Starting…',
  };

  it('uses localized editor stage labels when the stage is known', () => {
    assert.equal(resolveGenerationStageLabel('skeleton', stage), 'Laying out the spreads…');
  });

  it('falls back to raw backend stages when no localized label exists', () => {
    assert.equal(resolveGenerationStageLabel('cover-design', stage), 'cover-design');
  });

  it('uses the starting label when no stage has arrived yet', () => {
    assert.equal(resolveGenerationStageLabel(null, stage), 'Starting…');
    assert.equal(resolveGenerationStageLabel(undefined, stage), 'Starting…');
  });
});
