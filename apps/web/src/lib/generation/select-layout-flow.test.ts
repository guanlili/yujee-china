import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), 'utf8');

test('create flows persist the analyze requestId for the later select-layout handoff', () => {
  const draftSource = source('src/lib/generation/draft.ts');
  const heroSource = source('src/components/landing/HeroComposer.tsx');
  const myAlbumsSource = source('src/app/[locale]/my-albums/page.tsx');

  assert.match(draftSource, /requestId\?: string/);
  assert.match(heroSource, /const \{ albumId, requestId \} = await submitAnalyzeV3/);
  assert.match(heroSource, /albumRecipe\.save\(albumId, \{ language: draft\.language, photoIds, requestId \}\)/);
  assert.match(myAlbumsSource, /const \{ albumId, requestId \} = await submitAnalyzeV3/);
  assert.match(myAlbumsSource, /albumRecipe\.save\(albumId, \{ language, photoIds, requestId \}\)/);
});

test('album polling starts select-layout when analyze reaches the layout stage', () => {
  const pollSource = source('src/lib/hooks/use-album-poll.ts');

  assert.match(pollSource, /albumRecipe/);
  assert.match(pollSource, /selectLayoutRefsFromStore/);
  assert.match(pollSource, /submitSelectLayoutV3/);
  assert.match(pollSource, /generation\?\.stage === 'layout'/);
  assert.match(pollSource, /albumRecipe\.load\(uuid\)/);
  assert.match(pollSource, /submitSelectLayoutV3\(uuid,/);
});
