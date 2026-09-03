import assert from 'node:assert/strict';
import { test } from 'node:test';

// findSharedWithUser(collab rework §15.2)的真实执行测试 —— **无库可跑**:
// toSQL() 让 drizzle 真正走一遍查询构建(表/join/where/排序全部解析),
// 输出参数化 SQL 与绑定参数。闸门/CI 没有 DATABASE_URL,DB 测试会静默
// skip,跨用户读的归属边界靠这里保证真实覆盖(审查六轮抓出)。

const { albumRepo } = await import('./album-repo');

test('findSharedWithUserQuery.toSQL: members join albums,按 userId 参数化过滤', () => {
  const { sql, params } = albumRepo.findSharedWithUserQuery('user-abc').toSQL();

  // 出发表必须是 album_members(仅成员关系,不是 albums.user_id 全表)
  assert.match(sql, /from "album_members"/);
  // join 出相册本体
  assert.match(sql, /inner join "albums" on "album_members"\."album_id" = "albums"\."id"/);
  // 归属边界:user_id 以**参数**绑定(参数化,无注入面),值是调用者
  assert.match(sql, /"album_members"\."user_id" = \$\d+/);
  assert.deepEqual(params, ['user-abc']);
  // 排序:最新加入在前
  assert.match(sql, /order by "album_members"\."created_at" desc/);
});

test('findSharedWithUserQuery.toSQL: 不同调用者产生不同绑定参数(无硬编码)', () => {
  const a = albumRepo.findSharedWithUserQuery('user-a').toSQL();
  const b = albumRepo.findSharedWithUserQuery('user-b').toSQL();
  assert.deepEqual(a.params, ['user-a']);
  assert.deepEqual(b.params, ['user-b']);
  // SQL 形状必须完全一致(只有绑定值不同)—— 若实现里出现硬编码字面值,
  // 形状比较会失败。此前的 notEqual 断言恒真,是假护栏(审查七轮指认)。
  assert.equal(a.sql, b.sql);
});
