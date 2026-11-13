import { test } from 'node:test';
import assert from 'node:assert/strict';

import { db } from '../../db/client';
import { albumMessageRepo } from '../../db/repos/album-message-repo';
import { cleanupUser, isDbReachable, makeAlbum, makeUser } from '../../db/repos/__test__/setup';
import { chatService } from './chat-service';

/* chat 读取侧的硬约束:
   1. 先 findOwned 再读消息 —— 别人的相册一条都不能漏(消息里有 prompt/对话内容)。
   2. 只回展示所需字段(usage 等内部账不泄漏给前端)。
   3. limit 生效且按「最近」取(seq 倒序),layoutPatch 空归一为 null。 */

test('listMessages: 只回本人相册、字段收窄、limit 取最近', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const user = await makeUser('chat-owner');
  try {
    const album = await makeAlbum(user.id);
    // 写 3 条,seq 依次 1/2/3;最近 2 条应是 seq 3、2。
    for (const content of ['第一条', '第二条', '第三条']) {
      await db.transaction(async (tx) => {
        await albumMessageRepo.create(tx, {
          albumId: album.id,
          userId: user.id,
          role: 'user',
          content,
          chapterId: null,
        });
      });
    }

    const page = await chatService.listMessages(user.id, album.id, 2);
    assert.equal(page.messages.length, 2, 'limit 生效');
    // findRecentByAlbum = 取最近 N 条(desc)后 reverse() 成时间顺序 —— 最早的那条被裁掉。
    assert.equal(page.messages[0]?.content, '第二条', '窗口内按时间顺序呈现');
    assert.equal(page.messages[1]?.content, '第三条');
    assert.equal(page.messages.some((m) => m.content === '第一条'), false, '窗口外的老消息不返回');
    for (const m of page.messages) {
      assert.equal(m.layoutPatch, null, '空 layoutPatch 归一为 null');
      assert.equal('usage' in m, false, 'usage 不泄漏给前端');
    }

    const all = await chatService.listMessages(user.id, album.id);
    assert.equal(all.messages.length, 3, '不传 limit 取全部');
  } finally {
    await cleanupUser(user.id);
  }
});

test('listMessages: 别人的相册一律拒绝;不存在的相册 404', async (t) => {
  if (!(await isDbReachable())) {
    t.skip('DATABASE_URL is not reachable; skipping integration test');
    return;
  }
  const owner = await makeUser('chat-a');
  const other = await makeUser('chat-b');
  try {
    const album = await makeAlbum(owner.id);
    await db.transaction(async (tx) => {
      await albumMessageRepo.create(tx, { albumId: album.id, userId: owner.id, role: 'assistant', content: '私密', chapterId: null });
    });

    await assert.rejects(
      chatService.listMessages(other.id, album.id),
      (e: unknown) => (e as { code?: string }).code === 'ALBUM_NOT_OWNED',
      '非 owner 不许读别人相册的消息',
    );
    await assert.rejects(
      chatService.listMessages(owner.id, '00000000-0000-0000-0000-000000000000'),
      (e: unknown) => (e as { code?: string }).code === 'ALBUM_NOT_FOUND',
    );
  } finally {
    await cleanupUser(owner.id);
    await cleanupUser(other.id);
  }
});
