'use client';

import { use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';
import { ADDON_PACKS } from '@/config/pricing';
import { generationDraft } from '@/lib/generation/draft';
import { AppChrome } from '@/components/app/AppChrome';

type LedgerReason =
  | 'SIGNUP_BONUS'
  | 'GENERATION_HOLD'
  | 'GENERATION_SETTLE'
  | 'GENERATION_RELEASE'
  | 'PURCHASE'
  | 'REFUND'
  | 'ADMIN_ADJUST';

type Entry = {
  id: string;
  delta: number;
  reason: LedgerReason;
  balanceAfter: number;
  relatedAlbumId: string | null;
  createdAt: string;
};

export default function CreditsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = use(params);
  const t = getMessages(locale).dashboard.credits;
  const tc = getMessages(locale).dashboard.common;
  const checkout = useSearchParams().get('checkout');

  const [balance, setBalance] = useState<number | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  // A pending generation draft means the user detoured here to top up mid-generation
  // (§6.5.2). Offer a "continue" CTA so the loop closes back through the
  // homepage composer on return.
  // — surviving the external checkout redirect because the draft is in localStorage.
  const [hasDraft, setHasDraft] = useState(false);

  useEffect(() => {
    setHasDraft(!!generationDraft.load());
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [b, h] = await Promise.all([
          fetch('/api/v1/credit/balance').then((r) => r.json()),
          fetch('/api/v1/credit/history').then((r) => r.json()),
        ]);
        if (b.ok) setBalance(b.data.balance);
        if (h.ok) setEntries(h.data.entries);
        if (!b.ok || !h.ok) setErr(b.error?.message ?? h.error?.message ?? tc.error);
      } catch {
        setErr(tc.error);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buy = async (packId: string) => {
    setBuying(packId);
    setErr(null);
    try {
      const res = await fetch('/api/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId }),
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
      setBuying(null);
    }
  };

  return (
    <AppChrome locale={locale} activeNav="home">
      <div className="max-w-3xl mx-auto px-6 md:px-8 py-16">
        <h1 className="serif text-4xl mb-8">{t.title}</h1>

        {checkout === 'success' && (
          <p className="mb-6 rounded-lg bg-emerald-50 text-emerald-800 px-4 py-3 text-sm">
            {t.checkoutSuccess}
          </p>
        )}
        {checkout === 'cancel' && (
          <p className="mb-6 rounded-lg bg-amber-50 text-amber-800 px-4 py-3 text-sm">
            {t.checkoutCancel}
          </p>
        )}
        {err && <p className="mb-6 text-sm text-red-600">{err}</p>}

        {/* BILL-1 resume CTA — a pending draft means the user detoured here to
            top up mid-generation (§6.5.2). Must survive the UI restore. */}
        {hasDraft && (
          <div className="mb-8 rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent)]/[0.08] px-5 py-4">
            <p className="text-sm mb-3">{t.resumeBanner}</p>
            <a
              href={`/${locale}?resumeGeneration=1`}
              className="inline-block px-6 py-2.5 rounded-full bg-[var(--accent)] text-white text-sm tracking-wide"
            >
              {t.resumeCta}
            </a>
          </div>
        )}

        {/* 1 — Balance */}
        <section className="rounded-2xl bg-[var(--surface)] shadow-[var(--shadow-card)] p-6 mb-10">
          <p className="text-xs uppercase tracking-widest text-[var(--muted)]">{t.balance}</p>
          <p className="serif text-5xl mt-2">
            {balance === null ? '—' : balance.toLocaleString(locale)}
            <span className="text-base text-[var(--muted)] ml-2">{t.unit}</span>
          </p>
        </section>

        {/* 2 — Recharge (reuses pricing's addon-card style) */}
        <section className="mb-12">
          <h2 className="text-xl font-bold tracking-tight mb-1">{t.rechargeTitle}</h2>
          <p className="text-sm text-[var(--muted)] mb-7">{t.rechargeSub}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {ADDON_PACKS.map((pack) => (
              <div
                key={pack.id}
                className="bg-[var(--surface)] rounded-2xl p-6 text-center shadow-[var(--shadow-card)] hover:-translate-y-0.5 transition-all"
              >
                <div className="text-3xl font-extrabold tracking-tight tabular-nums mb-1">
                  {pack.credits.toLocaleString(locale)}
                </div>
                <div className="text-xs text-[var(--muted)] mb-4">{t.unit}</div>
                <div className="text-xl font-bold mb-1">${pack.priceUsd}</div>
                <div className="text-xs text-[var(--meta)] mb-4">
                  ${(pack.priceUsd / pack.credits).toFixed(4)} / credit
                </div>
                <button
                  type="button"
                  onClick={() => buy(pack.id)}
                  disabled={buying !== null}
                  className="w-full py-2.5 text-sm font-semibold rounded-full border border-[var(--fg)] text-[var(--fg)] hover:bg-[var(--fg)] hover:text-white transition-colors disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-[var(--fg)]"
                >
                  {buying === pack.id ? t.redirecting : t.buy}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* 3 — Ledger / history */}
        <section>
          <h2 className="text-xl font-bold tracking-tight mb-4">{t.history}</h2>
          {entries === null && <p className="text-[var(--muted)]">{tc.loading}</p>}
          {entries !== null && entries.length === 0 && (
            <p className="text-[var(--muted)]">{t.noHistory}</p>
          )}
          {entries !== null && entries.length > 0 && (
            <ul className="rounded-2xl bg-[var(--surface)] shadow-[var(--shadow-card)] divide-y divide-[var(--border-soft)] px-6">
              {entries.map((e) => (
                <li key={e.id} className="flex items-center justify-between py-3.5">
                  <div>
                    <p className="text-sm font-medium">{t.reason[e.reason] ?? e.reason}</p>
                    <p className="text-xs text-[var(--meta)]">
                      {new Date(e.createdAt).toLocaleString(locale)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-sm font-semibold tabular-nums ${
                        e.delta > 0
                          ? 'text-emerald-700'
                          : e.delta < 0
                            ? 'text-red-600'
                            : 'text-[var(--muted)]'
                      }`}
                    >
                      {e.delta > 0 ? '+' : ''}
                      {e.delta.toLocaleString(locale)}
                    </p>
                    <p className="text-xs text-[var(--meta)] tabular-nums">
                      {e.balanceAfter.toLocaleString(locale)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppChrome>
  );
}
