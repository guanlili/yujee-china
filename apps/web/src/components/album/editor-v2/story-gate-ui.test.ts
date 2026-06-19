import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));

function source(file: string): string {
  return readFileSync(join(here, file), 'utf8');
}

test('story gate UI only applies when the progress payload has V3 chapters', () => {
  const src = source('EditorPort.tsx');

  assert.match(
    src,
    /const hasStoryGate = \(storyProgress\?\.chapterOrder\.length \?\? 0\) > 0;/,
    'non-V3 authoring progress returns chapterOrder: [] and must not show the gate',
  );
  assert.match(
    src,
    /const showStoryGate = mode === 'authoring' && hasStoryGate;/,
    'the confirm-chapter button must be hidden for non-V3 authoring drafts',
  );
  assert.match(
    src,
    /hasStoryGate && storyProgress\?\.exportUnlocked !== true/,
    'export locking must be scoped to albums with a real V3 story gate',
  );
  assert.match(
    src,
    /\(storyGate\?\.chapterOrder\.length \?\? 0\) > 0[\s\S]*?storyGate\?\.exportUnlocked !== true/,
    'the imperative export guard must also ignore non-V3 authoring drafts',
  );
});
