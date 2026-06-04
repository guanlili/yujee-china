import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));

function source(file: string): string {
  return readFileSync(join(here, file), 'utf8');
}

test('editor isolates chat scrolling from the preview viewport', () => {
  const albumEditor = source('AlbumEditor.tsx');
  const chatPanel = source('ChatPanel.tsx');

  assert.match(
    albumEditor,
    /className="(?=[^"]*\bgrid\b)(?=[^"]*\bflex-1\b)(?=[^"]*\bmin-h-0\b)(?=[^"]*\boverflow-hidden\b)[^"]*"/,
    'editor grid must allow children to shrink and must not create document scroll',
  );
  assert.match(
    albumEditor,
    /<main className="(?=[^"]*\bmin-h-0\b)(?=[^"]*\boverflow-hidden\b)[^"]*"/,
    'preview pane must be a non-scrolling viewport',
  );
  assert.match(
    albumEditor,
    /<aside className="(?=[^"]*\bh-full\b)(?=[^"]*\bmin-h-0\b)(?=[^"]*\boverflow-hidden\b)[^"]*"/,
    'chat sidebar must define its own fixed-height scroll boundary',
  );
  assert.match(
    chatPanel,
    /className="(?=[^"]*\bh-full\b)(?=[^"]*\bmin-h-0\b)(?=[^"]*\boverflow-hidden\b)[^"]*"/,
    'chat panel root must not grow with message content',
  );
  assert.match(
    chatPanel,
    /className="(?=[^"]*\bflex-1\b)(?=[^"]*\bmin-h-0\b)(?=[^"]*\boverflow-y-auto\b)[^"]*"/,
    'chat messages body must own vertical scrolling',
  );
});
