import { currentAdmin } from '@/lib/auth/require-admin';
import { adminService } from '@/services/admin/admin-service';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';
import { AdminNav } from '@/components/admin/AdminNav';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { CreateInviteCodeForm } from '@/components/admin/CreateInviteCodeForm';

export default async function AdminInviteCodesPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const admin = await currentAdmin();
  if (!admin) return <AdminForbidden locale={locale} />;

  const codes = await adminService.listInviteCodes(admin.id);
  const t = getMessages(locale).admin.invites;
  const now = Date.now();

  const fmtDate = (d: Date) => new Date(d).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });

  const statusLabel = (c: (typeof codes)[number]) => {
    if (!c.active) return { text: t.statusInactive, cls: 'bg-neutral-100 text-neutral-600' };
    if (new Date(c.expiresAt).getTime() <= now) return { text: t.statusExpired, cls: 'bg-red-100 text-red-700' };
    if (c.maxRedemptions != null && c.redeemedCount >= c.maxRedemptions) {
      return { text: t.statusExhausted, cls: 'bg-amber-100 text-amber-800' };
    }
    return { text: t.statusLive, cls: 'bg-emerald-100 text-emerald-700' };
  };

  return (
    <main className="min-h-screen max-w-5xl mx-auto px-6 py-12">
      <AdminNav locale={locale} active="invites" />
      <h1 className="serif text-4xl mb-8">{t.title}</h1>

      <CreateInviteCodeForm locale={locale} />

      {codes.length === 0 ? (
        <p className="text-[var(--muted)]">{t.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
                <th className="px-4 py-3 font-medium">{t.thCode}</th>
                <th className="px-4 py-3 font-medium text-right">{t.thCredits}</th>
                <th className="px-4 py-3 font-medium text-right">{t.thRedeemed}</th>
                <th className="px-4 py-3 font-medium">{t.thStatus}</th>
                <th className="px-4 py-3 font-medium text-right">{t.thExpires}</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => {
                const st = statusLabel(c);
                const used = c.maxRedemptions != null ? `${c.redeemedCount} / ${c.maxRedemptions}` : `${c.redeemedCount} / ∞`;
                return (
                  <tr key={c.code} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-3 font-mono">{c.code}</td>
                    <td className="px-4 py-3 text-right">{c.credits.toLocaleString(locale)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{used}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${st.cls}`}>{st.text}</span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{fmtDate(c.expiresAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
