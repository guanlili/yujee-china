import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const stateSource = readFileSync(join(here, 'YujeeState.tsx'), 'utf8');

// YujeeState is the single unified empty/loading/error surface (illustration +
// title + message + optional dots), shared by the editor shell and its terminal
// error state. These guard the supplied illustrations and dot placement so the
// unified look can't silently regress to the old page skeleton.
describe('YujeeState unified illustrations', () => {
  it('uses the supplied state illustrations', () => {
    assert.match(stateSource, /01-empty-state-360\.webp/, 'empty state should use the supplied empty illustration');
    assert.match(stateSource, /02-loading-state-360\.webp/, 'loading state should use the supplied jellyfish illustration');
    assert.match(stateSource, /03-error-state-360\.webp/, 'error state should use the supplied error illustration');
    assert.match(stateSource, /YujeeLoadingDots/, 'loading state should render animated theme dots');
  });

  it('places loading dots below the illustration instead of on top of it', () => {
    assert.match(stateSource, /<YujeeLoadingDots className=\{compact \? 'mt-2' : 'mt-3'\}/, 'loading dots should sit below the illustration with vertical spacing');
    assert.doesNotMatch(stateSource, /<YujeeLoadingDots[^>]*(absolute|top-\[)/, 'dots must not be absolutely positioned over the illustration');
    assert.match(stateSource, /<\/div>\s*\{showDots && \(/, 'dots should render after the illustration wrapper');
  });
});
