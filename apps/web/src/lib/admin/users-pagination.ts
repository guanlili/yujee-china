/** 后台用户列表的分页/筛选参数解析与页码算术。
 *
 *  抽成纯函数是因为差一错全在这儿:「第 X–Y 条」是 1 基闭区间,而 offset 是 0 基;
 *  「有没有下一页」必须拿 offset+本页条数 跟**筛选后**的 total 比,不能看本页满没满
 *  —— 最后一页正好装满时看满没满会多翻出一张空白页。 */

export const USERS_PAGE_SIZE = 50;

/** 页码上限。不夹的话 `?page=99999999999999999999` 会把 offset 算成 5e+21,drizzle
 *  原样绑成查询参数,Postgres 按 bigint 解析失败 —— 一个脏 URL 就能让后台 500。 */
export const MAX_USERS_PAGE = 100_000;

import type { UsersView } from '@/db/repos/user-repo';

type Param = string | string[] | undefined;

const VIEWS: readonly UsersView[] = ['members', 'all', 'guests'];

function first(v: Param): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseUsersQuery(params: { page?: Param; anon?: Param; view?: Param }): {
  page: number;
  offset: number;
  limit: number;
  view: UsersView;
} {
  const raw = first(params.page) ?? '';
  // 只认纯数字:'-2' / '1.5' / 'abc' 一律回落第 1 页。落在真实页数之外的合法页码由
  // adminService.listUsers 夹到最后一页,这里只保证数值本身能安全进 SQL。
  const page = /^\d+$/.test(raw) ? Math.min(Math.max(Number(raw), 1), MAX_USERS_PAGE) : 1;
  // 非法 view 一律回落缺省 —— 别让脏 URL 决定后台看到什么。
  // ?anon=1 是分页改造那版的链接形状,映射到「全部」,存过的书签点开不至于变空。
  const rawView = first(params.view);
  const view: UsersView = VIEWS.includes(rawView as UsersView)
    ? (rawView as UsersView)
    : first(params.anon) === '1'
      ? 'all'
      : 'members';
  return {
    page,
    offset: (page - 1) * USERS_PAGE_SIZE,
    limit: USERS_PAGE_SIZE,
    view,
  };
}

export function usersPageRange({
  total,
  offset,
  count,
}: {
  total: number;
  offset: number;
  count: number;
}): { from: number; to: number; hasPrev: boolean; hasNext: boolean; totalPages: number } {
  return {
    from: count === 0 ? 0 : offset + 1,
    to: count === 0 ? 0 : offset + count,
    hasPrev: offset > 0,
    hasNext: offset + count < total,
    totalPages: Math.max(Math.ceil(total / USERS_PAGE_SIZE), 1),
  };
}
