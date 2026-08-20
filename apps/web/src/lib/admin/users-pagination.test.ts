import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUsersQuery,
  usersPageRange,
  USERS_PAGE_SIZE,
  MAX_USERS_PAGE,
} from './users-pagination';

test('parseUsersQuery: no params means page 1, guests hidden', () => {
  const q = parseUsersQuery({});
  assert.equal(q.page, 1);
  assert.equal(q.offset, 0);
  assert.equal(q.limit, USERS_PAGE_SIZE);
  assert.equal(q.view, 'members');
});

test('parseUsersQuery: page 3 skips two full pages', () => {
  assert.equal(parseUsersQuery({ page: '3' }).offset, USERS_PAGE_SIZE * 2);
});

test('parseUsersQuery: junk and out-of-range pages fall back to page 1', () => {
  for (const page of ['0', '-2', 'abc', '', '1.5']) {
    const q = parseUsersQuery({ page });
    assert.equal(q.page, 1, `page=${JSON.stringify(page)} should fall back to 1`);
    assert.equal(q.offset, 0);
  }
});

test('parseUsersQuery: anon=1 opts guests in, anything else keeps them out', () => {
  assert.equal(parseUsersQuery({ anon: '1' }).view, 'all');
  assert.equal(parseUsersQuery({ anon: '0' }).view, 'members');
  assert.equal(parseUsersQuery({ anon: 'yes' }).view, 'members');
});

// 超大页码不截会让 offset 溢出到科学计数法(5e+21),drizzle 原样绑成参数,
// Postgres 按 bigint 解析失败 → 后台 500。夹在一个人力可达的上限内。
test('parseUsersQuery: absurd page numbers are capped to a bindable offset', () => {
  const q = parseUsersQuery({ page: '99999999999999999999' });
  assert.equal(q.page, MAX_USERS_PAGE);
  assert.ok(Number.isSafeInteger(q.offset), 'offset must stay a safe integer');
  assert.equal(String(q.offset).includes('e'), false, 'offset must not serialize as 5e+21');
});

// Next 的 searchParams 对重复 key 给的是数组(?page=2&page=9),不处理就 NaN 翻空白页。
test('parseUsersQuery: repeated params take the first value', () => {
  const q = parseUsersQuery({ page: ['2', '9'], anon: ['1', '0'] });
  assert.equal(q.page, 2);
  assert.equal(q.view, 'all');
});

test('usersPageRange: middle page reports a 1-based inclusive span with both arrows', () => {
  const r = usersPageRange({ total: 120, offset: 50, count: 50 });
  assert.equal(r.from, 51);
  assert.equal(r.to, 100);
  assert.equal(r.hasPrev, true);
  assert.equal(r.hasNext, true);
  assert.equal(r.totalPages, 3);
});

test('usersPageRange: first page has no previous', () => {
  const r = usersPageRange({ total: 120, offset: 0, count: 50 });
  assert.equal(r.from, 1);
  assert.equal(r.to, 50);
  assert.equal(r.hasPrev, false);
  assert.equal(r.hasNext, true);
});

test('usersPageRange: last page has no next even when it is not full', () => {
  const r = usersPageRange({ total: 120, offset: 100, count: 20 });
  assert.equal(r.from, 101);
  assert.equal(r.to, 120);
  assert.equal(r.hasPrev, true);
  assert.equal(r.hasNext, false);
});

test('usersPageRange: an exactly-full last page still has no next', () => {
  const r = usersPageRange({ total: 100, offset: 50, count: 50 });
  assert.equal(r.to, 100);
  assert.equal(r.hasNext, false);
  assert.equal(r.totalPages, 2);
});

test('usersPageRange: empty result reports 0–0 and no arrows', () => {
  const r = usersPageRange({ total: 0, offset: 0, count: 0 });
  assert.equal(r.from, 0);
  assert.equal(r.to, 0);
  assert.equal(r.hasPrev, false);
  assert.equal(r.hasNext, false);
  assert.equal(r.totalPages, 1);
});

test('parseUsersQuery: 视图三态,缺省只看正式用户', () => {
  assert.equal(parseUsersQuery({}).view, 'members');
  assert.equal(parseUsersQuery({ view: 'all' }).view, 'all');
  assert.equal(parseUsersQuery({ view: 'guests' }).view, 'guests');
  // 非法值回落缺省,别让脏 URL 决定后台看到什么。
  assert.equal(parseUsersQuery({ view: 'drop table' }).view, 'members');
  assert.equal(parseUsersQuery({ view: ['guests', 'all'] }).view, 'guests');
});

test('parseUsersQuery: 旧书签 ?anon=1 仍映射到「全部」', () => {
  // 分页改造那版的链接形状,别让存过的后台书签点开变空。
  assert.equal(parseUsersQuery({ anon: '1' }).view, 'all');
  assert.equal(parseUsersQuery({ anon: '1', view: 'guests' }).view, 'guests', 'view 显式给出时优先');
});
