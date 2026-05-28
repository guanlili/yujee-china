import { currentAdmin } from '@/lib/auth/require-admin';
import { adminService } from '@/services/admin/admin-service';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';
import { AdminNav } from '@/components/admin/AdminNav';
import { AdminForbidden } from '@/components/admin/AdminForbidden';

const ALBUM_STATUSES = ['AGENT_RUNNING', 'EDITING', 'COMPLETED', 'FAILED'] as const;

export default async function AdminOverviewPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const admin = await currentAdmin();
  if (!admin) return <AdminForbidden locale={locale} />;

  const data = await adminService.getOverview(admin.id);
  const t = getMessages(locale).admin.overview;

  const stats = [
    { label: t.totalUsers, value: data.totalUsers },
    { label: t.totalAlbums, value: data.totalAlbums },
    { label: t.newUsers7d, value: data.newUsers7d },
    { label: t.newAlbums7d, value: data.newAlbums7d },
    { label: t.stuckJobs, value: data.stuckJobs },
  ];

  return (
    <main className="min-h-screen max-w-5xl mx-auto px-6 py-12">
      <AdminNav locale={locale} active="overview" />
      <h1 className="serif text-4xl mb-8">{t.title}</h1>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-12">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-[var(--border)] bg-white p-5">
            <p className="text-xs uppercase tracking-widest text-[var(--muted)]">{s.label}</p>
            <p className="serif text-3xl mt-2">{s.value.toLocaleString(locale)}</p>
          </div>
        ))}
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-4">{t.byStatus}</h2>
        <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-white">
          {ALBUM_STATUSES.map((status) => (
            <li key={status} className="flex items-center justify-between px-5 py-3">
              <span className="text-sm">{t.status[status]}</span>
              <span className="serif text-xl">
                {data.albumsByStatus[status].toLocaleString(locale)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
