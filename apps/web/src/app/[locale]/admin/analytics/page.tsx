import { currentAdmin } from '@/lib/auth/require-admin';
import { adminService } from '@/services/admin/admin-service';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';
import { AdminNav } from '@/components/admin/AdminNav';
import { AdminForbidden } from '@/components/admin/AdminForbidden';

const ALBUM_STATUSES = ['AGENT_RUNNING', 'EDITING', 'COMPLETED', 'FAILED'] as const;
const JOB_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'] as const;

export default async function AdminAnalyticsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const admin = await currentAdmin();
  if (!admin) return <AdminForbidden locale={locale} />;

  const data = await adminService.getAnalytics(admin.id);
  const t = getMessages(locale).admin.analytics;
  const n = (v: number) => v.toLocaleString(locale);

  return (
    <main className="min-h-screen max-w-5xl mx-auto px-6 py-12">
      <AdminNav locale={locale} active="analytics" />
      <h1 className="serif text-4xl mb-8">{t.title}</h1>

      <div className="grid md:grid-cols-2 gap-3 mb-3">
        <div className="rounded-xl border border-[var(--border)] bg-white p-5">
          <p className="text-xs uppercase tracking-widest text-[var(--muted)] mb-3">{t.users}</p>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between"><dt>{t.total}</dt><dd className="serif text-lg">{n(data.users.total)}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--muted)]">{t.last7d}</dt><dd>{n(data.users.last7d)}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--muted)]">{t.last30d}</dt><dd>{n(data.users.last30d)}</dd></div>
          </dl>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-white p-5">
          <p className="text-xs uppercase tracking-widest text-[var(--muted)] mb-3">{t.albums}</p>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between"><dt>{t.total}</dt><dd className="serif text-lg">{n(data.albums.total)}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--muted)]">{t.last7d}</dt><dd>{n(data.albums.last7d)}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--muted)]">{t.last30d}</dt><dd>{n(data.albums.last30d)}</dd></div>
          </dl>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3 mb-3">
        <div className="rounded-xl border border-[var(--border)] bg-white p-5">
          <p className="text-xs uppercase tracking-widest text-[var(--muted)] mb-3">{t.albumsByStatus}</p>
          <dl className="space-y-1.5 text-sm">
            {ALBUM_STATUSES.map((s) => (
              <div key={s} className="flex justify-between">
                <dt className="text-[var(--muted)]">{t.albumStatus[s]}</dt>
                <dd>{n(data.albumsByStatus[s])}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-white p-5">
          <p className="text-xs uppercase tracking-widest text-[var(--muted)] mb-3">{t.jobsByStatus}</p>
          <dl className="space-y-1.5 text-sm">
            {JOB_STATUSES.map((s) => (
              <div key={s} className="flex justify-between">
                <dt className="text-[var(--muted)]">{t.jobStatus[s]}</dt>
                <dd>{n(data.jobsByStatus[s])}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-white p-5">
        <p className="text-xs uppercase tracking-widest text-[var(--muted)] mb-3">{t.credits}</p>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-[var(--muted)]">{t.purchased}</dt>
            <dd className="serif text-2xl mt-1 text-emerald-700">+{n(data.credits.purchased30d)}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">{t.consumed}</dt>
            <dd className="serif text-2xl mt-1">{n(data.credits.consumed30d)}</dd>
          </div>
        </dl>
      </div>
    </main>
  );
}
