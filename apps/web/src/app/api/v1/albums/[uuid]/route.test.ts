import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AlbumPatchSchema } from './schema';

const here = dirname(fileURLToPath(import.meta.url));
const routeSource = readFileSync(join(here, 'route.ts'), 'utf8');

test('album PATCH delegates photoFilter updates without letting sibling fields be dropped', () => {
  assert.match(routeSource, /AlbumPatchSchema/);
  assert.match(routeSource, /body\.photoFilter !== undefined/);
  assert.match(routeSource, /albumService\.updatePhotoFilter\(userId, uuid, body\.photoFilter\)/);

  const photoFilter = {
    default: { lutId: 'fuji-portrait' as const, strength: 80 },
  };
  assert.deepEqual(AlbumPatchSchema.parse({ photoFilter }), { photoFilter });
  assert.deepEqual(AlbumPatchSchema.parse({ photoFilter: null }), { photoFilter: null });

  assert.equal(AlbumPatchSchema.safeParse({}).success, false);
  assert.equal(
    AlbumPatchSchema.safeParse({ title: 'Kept', boardBackground: null }).success,
    false,
  );
  assert.equal(AlbumPatchSchema.safeParse({ title: 'Kept', photoFilter }).success, false);
  assert.equal(
    AlbumPatchSchema.safeParse({ boardBackground: null, photoFilter }).success,
    false,
  );
});
