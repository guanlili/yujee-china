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
  assert.match(routeSource, /const \{ baseSettingsRevision \} = body/);
  assert.match(
    routeSource,
    /albumService\.updatePhotoFilter\(userId, uuid, body\.photoFilter, baseSettingsRevision\)/,
  );

  const photoFilter = {
    default: { lutId: 'fuji-portrait' as const, strength: 80 },
  };
  assert.deepEqual(AlbumPatchSchema.parse({ photoFilter, baseSettingsRevision: 0 }), {
    photoFilter,
    baseSettingsRevision: 0,
  });
  assert.deepEqual(AlbumPatchSchema.parse({ photoFilter: null, baseSettingsRevision: 3 }), {
    photoFilter: null,
    baseSettingsRevision: 3,
  });

  // 全局创作设置 OCC(Phase 2B):baseSettingsRevision 给了就必须合法,**省略是发布
  // 阶段 A 的过渡态** —— 主站前端尚未发这个字段,必填会让 owner 自己改书名/背景/
  // 滤镜全部 400。省略时 owner 走旧盲写、editor 由 service 拒(见 collab OCC 用例)。
  assert.equal(AlbumPatchSchema.safeParse({ photoFilter }).success, true);
  assert.equal(AlbumPatchSchema.safeParse({ photoFilter, baseSettingsRevision: -1 }).success, false);
  assert.equal(AlbumPatchSchema.safeParse({ photoFilter, baseSettingsRevision: 0.5 }).success, false);
  assert.equal(AlbumPatchSchema.safeParse({}).success, false);
  assert.equal(
    AlbumPatchSchema.safeParse({ title: 'Kept', boardBackground: null, baseSettingsRevision: 0 })
      .success,
    false,
  );
  assert.equal(
    AlbumPatchSchema.safeParse({ title: 'Kept', photoFilter, baseSettingsRevision: 0 }).success,
    false,
  );
  assert.equal(
    AlbumPatchSchema.safeParse({ boardBackground: null, photoFilter, baseSettingsRevision: 0 })
      .success,
    false,
  );
});
