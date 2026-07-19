import { currentAdmin } from '@/lib/auth/require-admin';
import { adminService } from '@/services/admin/admin-service';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';
import { AdminNav } from '@/components/admin/AdminNav';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { GrantCreditForm } from '@/components/admin/GrantCreditForm';
import { CreateUserForm } from '@/components/admin/CreateUserForm';

export default async function AdminUsersPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const admin = await currentAdmin();
  if (!admin) return <AdminForbidden locale={locale} />;

  const { users } = await adminService.listUsers(admin.id);
  const t = getMessages(locale).admin.users;

  return (
    <main className="min-h-screen max-w-5xl mx-auto px-6 py-12">
      <AdminNav locale={locale} active="users" />
      <h1 className="serif text-4xl mb-8">{t.title}</h1>

      <CreateUserForm locale={locale} />
      <GrantCreditForm locale={locale} />

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
                    ) : (
                      <span className="text-[var(--muted)]">{t.member}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">{u.creditBalance.toLocaleString(locale)}</td>
                  <td className="px-4 py-3 text-right">{u.albumCount.toLocaleString(locale)}</td>
                  <td className="px-4 py-3 text-right text-[var(--muted)]">
                    {new Date(u.createdAt).toLocaleDateString(locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
