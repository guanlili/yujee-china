import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { db } from '../client';
import { albums } from '../schema';
import { albumMemberRepo } from './album-member-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from './__test__/setup';

test('albumMemberRepo: addMemberIfAbsent + exists + removeMember + 幂等重复加入', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('member-owner');
  const editor = await makeUser('member-editor');
  try {
    const album = await makeAlbum(owner.id);

    // --- 初始无成员 ---
    assert.equal(await albumMemberRepo.exists(album.id, editor.id), false);

    // --- 加入后 exists 为真 ---
    await albumMemberRepo.addMemberIfAbsent(db, album.id, editor.id);
    assert.equal(await albumMemberRepo.exists(album.id, editor.id), true);

    // --- 重复 redeem 幂等:ON CONFLICT DO NOTHING,不抛错、不重复行 ---
    await albumMemberRepo.addMemberIfAbsent(db, album.id, editor.id);
    const members = await albumMemberRepo.listByAlbum(album.id);
    assert.equal(members.length, 1);
    assert.equal(members[0].userId, editor.id);

    // --- 移除后回到无成员 ---
    const removed = await albumMemberRepo.removeMember(db, album.id, editor.id);
    assert.equal(removed, true);
    assert.equal(await albumMemberRepo.exists(album.id, editor.id), false);

    // --- 再移除返回 false(不抛错),owner 从不在名单里 ---
    assert.equal(await albumMemberRepo.removeMember(db, album.id, editor.id), false);
    assert.equal(await albumMemberRepo.exists(album.id, owner.id), false);
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(editor.id);
  }
});

test('albumMemberRepo: 相册删除级联清理成员行', async (t) => {
  if (!(await isDbReachable())) { t.skip('DATABASE_URL is not reachable; skipping'); return; }
  const owner = await makeUser('member-cascade-owner');
  const editor = await makeUser('member-cascade-editor');
  try {
    const album = await makeAlbum(owner.id);
    await albumMemberRepo.addMemberIfAbsent(db, album.id, editor.id);
    assert.equal(await albumMemberRepo.exists(album.id, editor.id), true);

    await db.delete(albums).where(eq(albums.id, album.id));
    assert.equal(await albumMemberRepo.exists(album.id, editor.id), false);
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(editor.id);
  }
});
