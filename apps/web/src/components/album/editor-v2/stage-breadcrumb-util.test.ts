import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAGE_ORDER, computeStagePills } from './stage-breadcrumb-util';

test('STAGE_ORDER is the five 环节 in flow order', () => {
  assert.deepEqual(STAGE_ORDER, ['analysing', 'story', 'theme', 'cover', 'ready']);
});

test('computeStagePills: story 环节 → analysing done, story active, rest upcoming', () => {
  const pills = computeStagePills('story');
  assert.deepEqual(
    pills.map((p) => p.state),
    ['done', 'active', 'upcoming', 'upcoming', 'upcoming'],
  );
});

test('computeStagePills: first 环节 active, none done', () => {
  const pills = computeStagePills('analysing');
  assert.equal(pills[0].state, 'active');
  assert.ok(pills.slice(1).every((p) => p.state === 'upcoming'));
});

test('computeStagePills: last 环节 (ready) → all prior done, ready active', () => {
  const pills = computeStagePills('ready');
  assert.deepEqual(
    pills.map((p) => p.state),
    ['done', 'done', 'done', 'done', 'active'],
  );
});

test('computeStagePills: theme 环节 (export already unlocked) → story shows done', () => {
  // After the story gate opens (WP2.4: all chapters done → stage=theme), the
  // breadcrumb must show 章节故事 as completed, not still active.
  const pills = computeStagePills('theme');
  const story = pills.find((p) => p.key === 'story');
  assert.equal(story?.state, 'done');
});

test('computeStagePills: unknown/undefined stage falls back to first 环节 active', () => {
  for (const bad of [undefined, '', 'bogus']) {
    const pills = computeStagePills(bad);
    assert.equal(pills[0].state, 'active', `stage=${String(bad)}`);
  }
});
