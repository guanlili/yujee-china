import { currentAdmin } from '@/lib/auth/require-admin';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';
import { env } from '@/lib/env';
import { PHOTOS_PER_CREDIT } from '@/config/pricing';
import { AdminNav } from '@/components/admin/AdminNav';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { AdminMaintenance } from '@/components/admin/AdminMaintenance';

export default async function AdminSettingsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const admin = await currentAdmin();
  if (!admin) return <AdminForbidden locale={locale} />;

  const t = getMessages(locale).admin.settings;

  const providers = [
    { name: 'Waffo', on: Boolean(env.WAFFO_MERCHANT_ID) },
    { name: 'Creem(兜底)', on: Boolean(env.CREEM_API_KEY) },
  ];

  return (
    <main className="min-h-screen max-w-3xl mx-auto px-6 py-12">
      <AdminNav locale={locale} active="settings" />
      <h1 className="serif text-4xl mb-8">{t.title}</h1>

      <section className="rounded-xl border border-[var(--border)] bg-white p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">{t.config}</h2>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-[var(--muted)]">{t.creditCost}</dt>
            <dd>{PHOTOS_PER_CREDIT.toLocaleString(locale)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--muted)]">{t.agent}</dt>
            <dd className="font-mono text-xs">{env.AGENT_BASE_URL}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--muted)]">{t.providers}</dt>
            <dd className="flex gap-2">
              {providers.map((p) => (
                <span
                  key={p.name}
                  className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                    p.on ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {p.name} · {p.on ? t.configured : t.disabled}
                </span>
              ))}
            </dd>
          </div>
        </dl>
      </section>

      <AdminMaintenance locale={locale} />
    </main>
  );
}
