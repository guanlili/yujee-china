import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

test('root agent:dev script respects PORT so an occupied 8001 does not block local testing', () => {
  const packageJson = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  const script = packageJson.scripts['agent:dev'];
  assert.match(script, /\$\{PORT:-8001\}/);
  assert.doesNotMatch(script, /--port 8001(?:\s|$)/);
});
