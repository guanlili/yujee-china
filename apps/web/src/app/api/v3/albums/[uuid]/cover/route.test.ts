import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toBrowserCoverPatch } from './route-utils';
import { CoverBodySchema } from './schema';
import type { V3LayoutPatchEntry } from '@yujee/contracts';

const here = dirname(fileURLToPath(import.meta.url));
const routeSource = readFileSync(join(here, 'route.ts'), 'utf8');

type SafeParser = {
  safeParse: (value: unknown) =>
    | { success: true; data: Record<string, unknown> }
    | { success: false; error: unknown };
};

const bodySchema: SafeParser = CoverBodySchema;

test('cover route exports only Next.js route fields', () => {
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
});

test('cover route schema accepts transient cover photos and chat context', async () => {
  const parsed = bodySchema.safeParse({
    language: 'en',
    coverTemplateId: 'mag-01',
    endingTemplateId: 'mag-20',
    coverPhotoId: 'p1',
    endingPhotoId: null,
    coverPhoto: 'data:image/jpeg;base64,cover',
    endingPhoto: 'data:image/jpeg;base64,ending',
    userMessage: 'make the cover warmer',
    history: [{ role: 'user', content: 'I want a quiet cover.' }],
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.coverPhoto, 'data:image/jpeg;base64,cover');
    assert.equal(parsed.data.endingPhoto, 'data:image/jpeg;base64,ending');
    assert.equal(parsed.data.userMessage, 'make the cover warmer');
    assert.deepEqual(parsed.data.history, [{ role: 'user', content: 'I want a quiet cover.' }]);
  }
});

test('cover route schema rejects unknown fields and explicit null for Agent optional strings', async () => {
  assert.equal(
    bodySchema.safeParse({ language: 'en', coverPhotoDesc: 'browser must not send this' }).success,
    false,
  );

  for (const key of ['coverPhoto', 'endingPhoto', 'userMessage', 'history'] as const) {
    assert.equal(
      bodySchema.safeParse({ language: 'en', [key]: null }).success,
      false,
      `${key} must reject explicit null`,
    );
  }
});

test('toBrowserCoverPatch converts agent images/texts to browser imagesJson/textsJson', () => {
  const agentPatch: V3LayoutPatchEntry[] = [
    {
      pageIndex: 0,
      templateId: 'mag-01',
      images: { image: 'p1' },
      texts: { folio: '01' },
    },
  ];

  assert.deepEqual(toBrowserCoverPatch(agentPatch), [
    {
      pageIndex: 0,
      templateId: 'mag-01',
      imagesJson: { image: 'p1' },
      textsJson: { folio: '01' },
    },
  ]);
});

test('toBrowserCoverPatch preserves absent optional patch fields as absent', () => {
  assert.deepEqual(toBrowserCoverPatch([{ pageIndex: 2, templateId: 'mag-20' }]), [
    { pageIndex: 2, templateId: 'mag-20' },
  ]);
});
