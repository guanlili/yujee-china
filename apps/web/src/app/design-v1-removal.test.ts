import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..', '..');
const testFile = relative(webRoot, fileURLToPath(import.meta.url)).split('/').join('/');
const suppliedExternalEditor = '/Users/smalldog/Desktop/Yujee 页面/design/editor.html';

function walkSource(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSource(fullPath));
      continue;
    }

    if (entry.isFile() && /\.(?:css|ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

test('obsolete in-repo design-v1 artifacts stay removed', () => {
  assert.equal(
    existsSync(join(webRoot, 'design-v1')),
    false,
    'apps/web/design-v1 must not be restored; the supplied external design folder is /Users/smalldog/Desktop/Yujee 页面/',
  );
});

test('web source does not point at the removed in-repo design-v1 handoff', () => {
  const offenders: string[] = [];

  for (const file of walkSource(join(webRoot, 'src'))) {
    const rel = relative(webRoot, file).split('/').join('/');
    if (rel === testFile) continue;
    if (statSync(file).size > 1_000_000) continue;

    const text = readFileSync(file, 'utf8').replaceAll(suppliedExternalEditor, '');
    if (/design-v1|design\/editor\.html/.test(text)) offenders.push(rel);
  }

  assert.deepEqual(offenders, []);
});
