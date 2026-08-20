import Link from 'next/link';
import { currentAdmin } from '@/lib/auth/require-admin';
import { adminService } from '@/services/admin/admin-service';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';
import { AdminNav } from '@/components/admin/AdminNav';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { GrantCreditForm } from '@/components/admin/GrantCreditForm';
import { CreateUserForm } from '@/components/admin/CreateUserForm';
import { parseUsersQuery, usersPageRange } from '@/lib/admin/users-pagination';
import type { UsersView } from '@/db/repos/user-repo';

export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const admin = await currentAdmin();
  if (!admin) return <AdminForbidden locale={locale} />;

  const query = parseUsersQuery(await searchParams);
  const { users, total, offset } = await adminService.listUsers(admin.id, {
    limit: query.limit,
    offset: query.offset,
    view: query.view,
  });
  // 用服务端夹过的 offset 反推页码,不用 URL 里那个 —— 越界的 ?page=9 已经被拉回
  // 最后一页,标签再拿原值就会写出「第 0–0 条 / 第 9 / 2 页」这种自相矛盾的话。
  const page = Math.floor(offset / query.limit) + 1;
  const range = usersPageRange({ total, offset, count: users.length });
  const t = getMessages(locale).admin.users;

  // 页码与视图都走 URL,服务端组件因此不需要任何 client state;换视图时回到第 1 页,
  // 否则从「含游客的第 5 页」切到别的视图很容易落在超出范围的空白页上。
  const href = (targetPage: number, view: UsersView) => {
    const sp = new URLSearchParams();
    if (targetPage > 1) sp.set('page', String(targetPage));
    if (view !== 'members') sp.set('view', view);
    const qs = sp.toString();
    return `/${locale}/admin/users${qs ? `?${qs}` : ''}`;
  };

  // 三态:正式用户(缺省) / 全部 / 做了书但没注册的游客。第三个是定点优化的抓手 ——
  // 这批人传过照片、等过生成、翻过成品,却没留下账号,是漏斗上最该盯的一段。
  const VIEW_TABS: { view: UsersView; label: string }[] = [
    { view: 'members', label: t.viewMembers },
    { view: 'all', label: t.viewAll },
    { view: 'guests', label: t.viewGuestsWithAlbums },
  ];

  const pagerLink =
    'px-3 py-1.5 rounded-lg border border-[var(--border)] bg-white hover:border-[var(--accent)]';
  const pagerActive =
    'px-3 py-1.5 rounded-lg border border-[var(--accent)] bg-[var(--accent)] text-white cursor-default';
  const pagerDisabled =
    'px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--muted)] opacity-50 cursor-default';

  return (
    <main className="min-h-screen max-w-5xl mx-auto px-6 py-12">
      <AdminNav locale={locale} active="users" />
      <h1 className="serif text-4xl mb-8">{t.title}</h1>

      <CreateUserForm locale={locale} />
      <GrantCreditForm locale={locale} />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 text-sm">
        <p className="text-[var(--muted)]">
          {t.range
            .replace('{from}', range.from.toLocaleString(locale))
            .replace('{to}', range.to.toLocaleString(locale))
            .replace('{total}', total.toLocaleString(locale))}
        </p>
        <div className="flex items-center gap-2">
          {VIEW_TABS.map((tab) =>
            tab.view === query.view ? (
              <span key={tab.view} className={pagerActive}>
                {tab.label}
              </span>
            ) : (
              <Link key={tab.view} href={href(1, tab.view)} className={pagerLink}>
                {tab.label}
              </Link>
            ),
          )}
        </div>
      </div>

      {users.length === 0 ? (
        <p className="text-[var(--muted)]">{t.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
                <th className="px-4 py-3 font-medium">{t.email}</th>
                <th className="px-4 py-3 font-medium">{t.name}</th>
                <th className="px-4 py-3 font-medium">{t.role}</th>
                <th className="px-4 py-3 font-medium text-right">{t.credits}</th>
                <th className="px-4 py-3 font-medium text-right">{t.albums}</th>
                <th className="px-4 py-3 font-medium text-right">{t.joined}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">{u.name ?? t.noName}</td>
                  <td className="px-4 py-3">
                    {u.isAdmin ? (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                        {t.admin}
                      </span>
                    ) : u.isAnonymous ? (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        {t.guest}
                      </span>
                    ) : (
                      <span className="text-[var(--muted)]">{t.member}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">{u.creditBalance.toLocaleString(locale)}</td>
                  <td className="px-4 py-3 text-right">
                    {/* 相册数可点 = 直接进那本书看用户做到哪一步。一个人可能有多本,
                        这里进的是最新一本(游客上限 1 本,对他们即全部)。 */}
                    {u.albumCount > 0 && u.latestAlbumId ? (
                      <Link
                        href={`/${locale}/admin/albums/${u.latestAlbumId}`}
                        className="underline decoration-dotted underline-offset-4 hover:text-[var(--accent)]"
                      >
                        {u.albumCount.toLocaleString(locale)}
                      </Link>
                    ) : (
                      u.albumCount.toLocaleString(locale)
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--muted)]">
                    {new Date(u.createdAt).toLocaleDateString(locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {range.totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 mt-4 text-sm">
          {range.hasPrev ? (
            <Link href={href(page - 1, query.view)} className={pagerLink}>
              {t.prev}
            </Link>
          ) : (
            <span className={pagerDisabled}>{t.prev}</span>
          )}
          <span className="text-[var(--muted)]">
            {t.pageOf
              .replace('{page}', page.toLocaleString(locale))
              .replace('{totalPages}', range.totalPages.toLocaleString(locale))}
          </span>
          {range.hasNext ? (
            <Link href={href(page + 1, query.view)} className={pagerLink}>
              {t.next}
            </Link>
          ) : (
            <span className={pagerDisabled}>{t.next}</span>
          )}
        </div>
      )}
    </main>
  );
}
