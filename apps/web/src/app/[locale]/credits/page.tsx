'use client';

import { use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';
import { ADDON_PACKS } from '@/config/pricing';
import { generationDraft } from '@/lib/generation/draft';

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
  // A pending /create draft means the user detoured here to top up mid-generation
  // (§6.5.2). Offer a "continue" CTA so the loop closes back to /create on return
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
    <main className="min-h-screen max-w-3xl mx-auto px-6 py-16">
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

      {hasDraft && (
        <div className="mb-8 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-5 py-4">
          <p className="text-sm mb-3">{t.resumeBanner}</p>
          <a
            href="/create"
            className="inline-block px-6 py-2.5 rounded-full bg-[var(--accent)] text-white text-sm tracking-wide"
          >
            {t.resumeCta}
          </a>
        </div>
      )}

      <section className="rounded-xl border border-[var(--border)] bg-white p-6 mb-10">
        <p className="text-xs uppercase tracking-widest text-[var(--muted)]">{t.balance}</p>
        <p className="serif text-5xl mt-2">
          {balance === null ? '—' : balance.toLocaleString(locale)}
          <span className="text-base text-[var(--muted)] ml-2">{t.unit}</span>
        </p>
      </section>

      <section className="mb-12">
        <h2 className="text-lg font-semibold">{t.rechargeTitle}</h2>
        <p className="text-sm text-[var(--muted)] mb-4">{t.rechargeSub}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {ADDON_PACKS.map((pack) => (
            <button
              key={pack.id}
              type="button"
              onClick={() => buy(pack.id)}
              disabled={buying !== null}
              className="rounded-xl border border-[var(--border)] bg-white p-4 text-left hover:bg-[#f9f9f9] transition-colors disabled:opacity-50"
            >
              <p className="serif text-2xl">{pack.credits.toLocaleString(locale)}</p>
              <p className="text-xs text-[var(--muted)] mb-3">{t.unit}</p>
              <span className="inline-block text-sm font-medium rounded-full bg-[var(--accent)] text-white px-3 py-1">
                {buying === pack.id ? t.redirecting : `${t.buy} · $${pack.priceUsd}`}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-4">{t.history}</h2>
        {entries === null && <p className="text-[var(--muted)]">{tc.loading}</p>}
        {entries !== null && entries.length === 0 && (
          <p className="text-[var(--muted)]">{t.noHistory}</p>
        )}
        <ul className="divide-y divide-[var(--border)]">
          {(entries ?? []).map((e) => (
            <li key={e.id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium">{t.reason[e.reason] ?? e.reason}</p>
                <p className="text-xs text-[var(--muted)]">
                  {new Date(e.createdAt).toLocaleString(locale)}
                </p>
              </div>
              <div className="text-right">
                <p
                  className={`text-sm font-semibold ${
                    e.delta > 0 ? 'text-emerald-700' : e.delta < 0 ? 'text-red-600' : 'text-[var(--muted)]'
                  }`}
                >
                  {e.delta > 0 ? '+' : ''}
                  {e.delta.toLocaleString(locale)}
                </p>
                <p className="text-xs text-[var(--muted)]">{e.balanceAfter.toLocaleString(locale)}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
