import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const routeSource = readFileSync(join(here, '[uuid]', 'cover-thumbnail', 'route.ts'), 'utf8');

test('cover thumbnail confirmation requires the opaque revision returned by signing', () => {
  assert.match(routeSource, /r2Key:\s*z\.string\(\)\.min\(1\)/);
  assert.match(routeSource, /coverRevision:\s*z\.string\(\)\.regex/);
  assert.match(routeSource, /albumService\.confirmCoverThumbnail\(user\.id, uuid, body\)/);
});
