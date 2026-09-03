import { test } from 'node:test';
import assert from 'node:assert/strict';

// R2 signing needs credentials; set them BEFORE importing anything that reads env
// (env.ts parses at import time). Dynamic imports below run after this.
process.env.R2_ACCOUNT_ID ??= 'test-account';
process.env.R2_ACCESS_KEY_ID ??= 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY ??= 'test-secret-key';
process.env.R2_BUCKET ??= 'test-bucket';
process.env.R2_PUBLIC_BASE_URL ??= 'https://cdn.yujeeai.test';

const { photoOriginalService } = await import('./photo-original-service');
const { albumPhotoRepo } = await import('../../db/repos/album-photo-repo');
const { albumService } = await import('./album-service');
const { cleanupUser, isDbReachable, makeAlbum, makeUser } = await import(
  '../../db/repos/__test__/setup'
);

const P1 = '550e8400-e29b-41d4-a716-446655440001';
const P2 = '550e8400-e29b-41d4-a716-446655440002';
const P3 = '550e8400-e29b-41d4-a716-446655440003';

function entry(photoId: string, overrides: Partial<{ width: number; height: number; bytes: number }> = {}) {
  return {
    photoId,
    width: overrides.width ?? 4032,
    height: overrides.height ?? 3024,
    bytes: overrides.bytes ?? 2_500_000,
  };
}

test('photo-original signUpload: owner gets signed PUTs with correct keys; non-owner and oversized batches are rejected', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const owner = await makeUser('photo-orig-sign-owner');
  const stranger = await makeUser('photo-orig-sign-stranger');
  try {
    const album = await makeAlbum(owner.id, { photoCount: 2 });

    const signed = await photoOriginalService.signUpload(owner.id, album.id, [
      entry(P1),
      entry(P2),
    ]);
    assert.equal(signed.length, 2);
    assert.equal(signed[0]!.photoId, P1);
    assert.equal(signed[0]!.r2Key, `photo-originals/${album.id}/${P1}.jpg`);
    assert.ok(signed[0]!.putUrl.includes('X-Amz-Signature'));
    assert.equal(signed[1]!.r2Key, `photo-originals/${album.id}/${P2}.jpg`);

    await assert.rejects(
      () => photoOriginalService.signUpload(stranger.id, album.id, [entry(P1)]),
      // 协同收口:上传是 Creator 能力,路人拿 ALBUM_ACCESS_DENIED。
      (err: { code?: string }) => err.code === 'ALBUM_ACCESS_DENIED',
    );

    const tooMany = Array.from({ length: 301 }, (_, i) => entry(`over-${i}`));
    await assert.rejects(
      () => photoOriginalService.signUpload(owner.id, album.id, tooMany),
      (err: { code?: string }) => err.code === 'VALIDATION_FAILED',
    );
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(stranger.id);
  }
});

test('photo-original confirm: entries land uploaded, missing lands missing, repeats are idempotent, uploaded never downgrades', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('photo-orig-confirm');
  try {
    const album = await makeAlbum(user.id, { photoCount: 2 });

    const first = await photoOriginalService.confirm(user.id, album.id, {
      entries: [entry(P1)],
      missing: [P2],
    });
    assert.deepEqual(first, { uploaded: 1, missing: 1 });

    let rows = await albumPhotoRepo.findByAlbum(album.id);
    let byId = new Map(rows.map((r) => [r.photoId, r]));
    assert.equal(byId.get(P1)?.status, 'uploaded');
    assert.equal(byId.get(P1)?.width, 4032);
    assert.equal(byId.get(P2)?.status, 'missing');

    // Repeat confirm with the same payload is idempotent.
    const repeat = await photoOriginalService.confirm(user.id, album.id, {
      entries: [entry(P1)],
      missing: [P2],
    });
    assert.deepEqual(repeat, { uploaded: 1, missing: 1 });

    // Already-uploaded P1 shows up in `missing` on a later confirm → must NOT downgrade,
    // and must not clobber its stored metadata either.
    const noDowngrade = await photoOriginalService.confirm(user.id, album.id, {
      missing: [P1],
    });
    assert.deepEqual(noDowngrade, { uploaded: 1, missing: 1 });

    rows = await albumPhotoRepo.findByAlbum(album.id);
    byId = new Map(rows.map((r) => [r.photoId, r]));
    assert.equal(byId.get(P1)?.status, 'uploaded');
    assert.equal(byId.get(P1)?.width, 4032);
    assert.equal(byId.get(P1)?.height, 3024);
    assert.equal(byId.get(P1)?.bytes, 2_500_000);
  } finally {
    await cleanupUser(user.id);
  }
});

test('photo-original getUrls: only uploaded photoIds get a signed GET; missing/unregistered are omitted', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('photo-orig-urls');
  try {
    const album = await makeAlbum(user.id, { photoCount: 2 });
    await photoOriginalService.confirm(user.id, album.id, {
      entries: [entry(P1)],
      missing: [P2],
    });

    const urls = await photoOriginalService.getUrls(user.id, album.id, [P1, P2, P3]);
    assert.deepEqual(Object.keys(urls), [P1]);
    assert.ok(urls[P1]!.includes('X-Amz-Signature'));
    assert.ok(urls[P1]!.includes(`photo-originals/${album.id}/${P1}.jpg`));
  } finally {
    await cleanupUser(user.id);
  }
});

test('getDetail projects photoOriginals counts', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const user = await makeUser('photo-orig-detail');
  try {
    const album = await makeAlbum(user.id, { photoCount: 2 });
    await photoOriginalService.confirm(user.id, album.id, {
      entries: [entry(P1)],
      missing: [P2],
    });

    const detail = await albumService.getDetail(user.id, album.id);
    assert.deepEqual(detail.album.photoOriginals, { uploaded: 1, missing: 1 });
  } finally {
    await cleanupUser(user.id);
  }
});

// 协同授权收口后:路人(既非 owner 也非 editor)拿到 ALBUM_ACCESS_DENIED
// —— requireAccess/resolveRole 的统一口径,不再是 owner-only 的 ALBUM_NOT_OWNED。
test('photo-original confirm/getUrls: non-owner is rejected', async (t) => {
  if (!(await isDbReachable())) return t.skip('DATABASE_URL unreachable');
  const owner = await makeUser('photo-orig-nonowner-owner');
  const stranger = await makeUser('photo-orig-nonowner-stranger');
  try {
    const album = await makeAlbum(owner.id, { photoCount: 1 });

    await assert.rejects(
      () => photoOriginalService.confirm(stranger.id, album.id, { entries: [entry(P1)] }),
      (err: { code?: string }) => err.code === 'ALBUM_ACCESS_DENIED',
    );
    await assert.rejects(
      () => photoOriginalService.getUrls(stranger.id, album.id, [P1]),
      (err: { code?: string }) => err.code === 'ALBUM_ACCESS_DENIED',
    );
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(stranger.id);
  }
});
