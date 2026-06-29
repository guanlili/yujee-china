import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SelectLayoutBodySchema } from './schema';

const here = dirname(fileURLToPath(import.meta.url));
const routeSource = readFileSync(join(here, 'route.ts'), 'utf8');

type SafeParser = {
  safeParse: (value: unknown) =>
    | { success: true; data: Record<string, unknown> }
    | { success: false; error: unknown };
};

const bodySchema: SafeParser = SelectLayoutBodySchema;

test('select-layout route exports only Next.js route fields', () => {
  const allowed = new Set([
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'HEAD',
    'OPTIONS',
    'runtime',
    'dynamic',
    'dynamicParams',
    'revalidate',
    'fetchCache',
    'preferredRegion',
    'maxDuration',
    'generateStaticParams',
    'config',
  ]);
  const exported = [...routeSource.matchAll(/export\s+(?:async\s+function|const)\s+([A-Za-z0-9_]+)/g)]
    .map((m) => m[1]!);

  assert.deepEqual(
    exported.filter((name) => !allowed.has(name)),
    [],
    'Next Route modules must not export schemas or other helper fields',
  );
  assert.match(routeSource, /submitSelectLayoutV3/);
});

test('select-layout route schema accepts only requestId, language, and browser refs', () => {
  const parsed = bodySchema.safeParse({
    requestId: 'layout-r1',
    language: 'en',
    refs: { p1: 'data:image/jpeg;base64,AA==' },
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.deepEqual(parsed.data, {
      requestId: 'layout-r1',
      language: 'en',
      refs: { p1: 'data:image/jpeg;base64,AA==' },
    });
  }

  assert.equal(
    bodySchema.safeParse({
      requestId: 'layout-r1',
      language: 'en',
      refs: { p1: 'data:image/jpeg;base64,AA==' },
      chapters: [],
    }).success,
    false,
  );
  assert.equal(
    bodySchema.safeParse({
      requestId: 'layout-r1',
      language: 'en',
      refs: { p1: 'data:image/jpeg;base64,AA==' },
      callbackUrl: 'https://web.test/api/v3/internal/job-progress',
    }).success,
    false,
  );
  assert.equal(
    bodySchema.safeParse({
      requestId: 'layout-r1',
      language: 'en',
      refs: { p1: 'not-a-data-url' },
    }).success,
    false,
  );
});
