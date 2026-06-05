'use client';

import { useState } from 'react';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';
import { ADDON_PACKS } from '@/config/pricing';
import { useSession } from '@/lib/auth/client';
import { MarketingChrome } from '@/components/marketing/MarketingChrome';

export function PricingView({ locale }: { locale: Locale }) {
  const t = getMessages(locale).pricing;
  const tc = getMessages(locale).dashboard.common;
  const { data: session, isPending } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Public page: signed-out visitors still see every pack. Pressing "buy" only
  // hits checkout when logged in (it 401s otherwise); guests detour to login
  // and land back on /pricing to finish (#97).
  const buy = async (packId: string) => {
    if (isPending) return;
    if (!session) {
      window.location.href = `/${locale}/login?from=/${locale}/pricing`;
      return;
    }
    setBusy(packId);
    setErr(null);
    try {
      const res = await fetch('/api/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId, locale, from: 'home' }),
      });
      const json = await res.json();
      if (json.ok && json.data?.url) {
        window.location.href = json.data.url;
        return;
      }
      setErr(json.error?.message ?? tc.error);
    } catch {
      setErr(tc.error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <MarketingChrome locale={locale} pathname="/pricing">
      <div className="max-w-5xl mx-auto px-6 md:px-8 pt-16 pb-24">
        <header className="text-center mb-12">
          <h1 className="serif text-4xl md:text-5xl tracking-tight mb-3">{t.title}</h1>
          <p className="text-[var(--muted)] text-base md:text-lg">{t.subtitle}</p>
        </header>

        {err && <p className="mb-6 text-center text-sm text-red-600">{err}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          {ADDON_PACKS.map((pack) => (
            <div
              key={pack.id}
              className="bg-[var(--surface)] rounded-2xl p-7 text-center shadow-[var(--shadow-card)] hover:-translate-y-0.5 transition-all"
            >
              <div className="text-4xl font-extrabold tracking-tight tabular-nums mb-1">
                {pack.books.toLocaleString(locale)}
              </div>
              <div className="text-xs text-[var(--muted)] mb-5">
                {pack.books === 1 ? t.unitSingular : t.unit}
              </div>
              <div className="text-2xl font-bold mb-1">${pack.priceUsd}</div>
              <div className="text-xs text-[var(--meta)] mb-5">
                ${(pack.priceUsd / pack.books).toFixed(2)} {t.perBook}
              </div>
              <button
                type="button"
                onClick={() => buy(pack.id)}
                disabled={busy !== null || isPending}
                className="w-full py-2.5 text-sm font-semibold rounded-full border border-[var(--fg)] text-[var(--fg)] hover:bg-[var(--fg)] hover:text-white transition-colors disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-[var(--fg)]"
              >
                {busy === pack.id ? t.redirecting : t.buy}
              </button>
            </div>
          ))}
        </div>

        <section className="max-w-2xl mx-auto rounded-2xl bg-[var(--surface)] shadow-[var(--shadow-card)] p-7">
          <h2 className="text-lg font-bold tracking-tight mb-4">{t.includesTitle}</h2>
          <ul className="space-y-2.5">
            {t.includes.map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-sm text-[var(--fg-2)]">
                <span aria-hidden className="mt-1 text-[var(--accent)]">✓</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>

        {!isPending && !session && (
          <p className="mt-8 text-center text-sm text-[var(--muted)]">{t.loginHint}</p>
        )}
      </div>
    </MarketingChrome>
  );
}
