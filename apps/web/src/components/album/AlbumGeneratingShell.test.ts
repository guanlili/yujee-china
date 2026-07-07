import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveGenerationStageLabel } from './AlbumGeneratingShell';

const here = dirname(fileURLToPath(import.meta.url));
const shellSource = readFileSync(join(here, 'AlbumGeneratingShell.tsx'), 'utf8');
const stateSource = readFileSync(join(here, '..', 'app', 'YujeeState.tsx'), 'utf8');

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

describe('album terminal and loading states', () => {
  it('uses the supplied state illustrations instead of the old page skeleton', () => {
    assert.match(stateSource, /01-empty-state-360\.webp/, 'empty state should use the supplied empty illustration');
    assert.match(stateSource, /02-loading-state-360\.webp/, 'loading state should use the supplied jellyfish illustration');
    assert.match(stateSource, /03-error-state-360\.webp/, 'error state should use the supplied error illustration');
    assert.match(stateSource, /YujeeLoadingDots/, 'loading state should overlay the animated theme dots');
    assert.doesNotMatch(shellSource, /function PageSkeleton/, 'album shell must not keep the old skeleton loader');
    assert.match(shellSource, /variant="loading"/, 'album shell should render the shared loading state');
    assert.match(shellSource, /variant="error"/, 'album shell terminal states should render the shared error state');
  });
});
