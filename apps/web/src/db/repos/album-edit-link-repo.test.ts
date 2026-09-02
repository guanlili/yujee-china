import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../client';
import { albums } from '../schema';
import { albumEditLinkRepo } from './album-edit-link-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from './__test__/setup';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

test('albumEditLinkRepo: upsert 创建/旋转 + findByTokenHash + deleteByAlbum', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('edit-link-owner');
  try {
    const album = await makeAlbum(owner.id);

    // --- 首次创建 ---
    const tokenA = randomBytes(32).toString('base64url');
    const created = await albumEditLinkRepo.upsert(db, album.id, hashToken(tokenA), owner.id);
    assert.equal(created.albumId, album.id);
    assert.equal(created.tokenHash, hashToken(tokenA));
    let found = await albumEditLinkRepo.findByTokenHash(hashToken(tokenA));
    assert.ok(found);
    assert.equal(found.albumId, album.id);
    assert.equal(found.createdBy, owner.id);

    // --- 旋转:同 albumId 覆盖,旧 hash 立即失效 ---
    const tokenB = randomBytes(32).toString('base64url');
    const rotated = await albumEditLinkRepo.upsert(db, album.id, hashToken(tokenB), owner.id);
    assert.equal(rotated.albumId, album.id);
    assert.equal(rotated.tokenHash, hashToken(tokenB));
    assert.equal(await albumEditLinkRepo.findByTokenHash(hashToken(tokenA)), undefined,
      '旋转后旧 token hash 必须查不到(旧链接立即失效)');
    found = await albumEditLinkRepo.findByTokenHash(hashToken(tokenB));
    assert.ok(found);

    // --- 明文 token 从不落库:hash 列与明文必然不同 ---
    assert.notEqual(found.tokenHash, tokenB);

    // --- 删除 ---
    await albumEditLinkRepo.deleteByAlbum(db, album.id);
    assert.equal(await albumEditLinkRepo.findByTokenHash(hashToken(tokenB)), undefined);
  } finally {
    await cleanupUser(owner.id);
  }
});

test('albumEditLinkRepo: 相册删除级联清理链接行', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('edit-link-cascade');
  try {
    const album = await makeAlbum(owner.id);
    const token = randomBytes(32).toString('base64url');
    await albumEditLinkRepo.upsert(db, album.id, hashToken(token), owner.id);

    await db.delete(albums).where(eq(albums.id, album.id));
    assert.equal(await albumEditLinkRepo.findByTokenHash(hashToken(token)), undefined);
  } finally {
    await cleanupUser(owner.id);
  }
});
