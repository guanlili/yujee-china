import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../../../../../');

function listFiles(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

test('web no longer exposes browser-facing v2 api routes or v2 album calls', () => {
  assert.equal(existsSync(path.join(repoRoot, 'apps/web/src/app/api/' + 'v2')), false);

  const forbidden = ['/api/' + 'v2', '/' + 'v2' + '/album'];
  const offenders = listFiles(path.join(repoRoot, 'apps/web/src'))
    .filter((file) => !file.endsWith('v3-teardown-guard.test.ts'))
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .filter((file) => {
      const text = readFileSync(file, 'utf8');
      return forbidden.some((token) => text.includes(token));
    })
    .map((file) => path.relative(repoRoot, file));

  assert.deepEqual(offenders, []);
});

test('contracts no longer exposes the old v2 contract module', () => {
  assert.equal(existsSync(path.join(repoRoot, 'packages/contracts/src/' + 'v2.ts')), false);

  const indexText = readFileSync(path.join(repoRoot, 'packages/contracts/src/index.ts'), 'utf8');
  assert.equal(indexText.includes("./" + "v2"), false);

  const packageJson = JSON.parse(
    readFileSync(path.join(repoRoot, 'packages/contracts/package.json'), 'utf8'),
  ) as { exports?: Record<string, string> };
  assert.equal(Object.hasOwn(packageJson.exports ?? {}, './' + 'v2'), false);
});

test('web keeps the v1 infrastructure route whitelist used by V3', () => {
  const routes = [
    'apps/web/src/app/api/v1/albums/route.ts',
    'apps/web/src/app/api/v1/albums/[uuid]/route.ts',
    'apps/web/src/app/api/v1/albums/[uuid]/pdf-upload-url/route.ts',
    'apps/web/src/app/api/v1/albums/[uuid]/pdf/route.ts',
    'apps/web/src/app/api/v1/albums/[uuid]/cover-thumbnail-upload-url/route.ts',
    'apps/web/src/app/api/v1/albums/[uuid]/cover-thumbnail/route.ts',
    'apps/web/src/app/api/v1/fonts/subset/route.ts',
    'apps/web/src/app/api/v1/credit/balance/route.ts',
    'apps/web/src/app/api/v1/credit/history/route.ts',
    'apps/web/src/app/api/v1/billing/checkout/route.ts',
    'apps/web/src/app/api/v1/user/me/route.ts',
    'apps/web/src/app/api/v1/user/billing/route.ts',
    'apps/web/src/app/api/v1/admin/cleanup-photos/route.ts',
    'apps/web/src/app/api/v1/admin/recover-stuck/route.ts',
    'apps/web/src/app/api/v1/health/route.ts',
  ];

  const missing = routes.filter((route) => !existsSync(path.join(repoRoot, route)));

  assert.deepEqual(missing, []);
});
