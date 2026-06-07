'use client';

import { useState } from 'react';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';
import { ADDON_PACKS } from '@/config/pricing';
import { useSession } from '@/lib/auth/client';

// Shared pricing block rendered inline on both Homes (#pricing anchor). Reuses
// the original PricingView checkout flow verbatim: signed-out visitors still see
// every pack; pressing "buy" only hits checkout when logged in (it 401s
// otherwise), guests detour to login and land back on the home #pricing anchor.
export function PricingSection({ locale }: { locale: Locale }) {
  const t = getMessages(locale).pricing;
  const tc = getMessages(locale).dashboard.common;
  const { data: session, isPending } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Cheapest pack sets the baseline used for the per-pack "save %" badge.
  const baselinePerBook = ADDON_PACKS[0].priceUsd / ADDON_PACKS[0].books;
  // Best value = the largest pack (most books). Design highlights this card.
  const bestPackId = ADDON_PACKS.reduce((a, b) => (b.books > a.books ? b : a)).id;

  const buy = async (packId: string) => {
    if (isPending) return;
    if (!session) {
      window.location.href = `/${locale}/login?from=${encodeURIComponent(
        `/${locale}#pricing`,
      )}`;
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
    <section
      id="pricing"
      className="scroll-mt-20 px-5 py-14 sm:px-8 sm:py-20"
    >
      {/* Brand glow buy button (DESIGN.md §4): black pill with a blurred
          green→purple→lime gradient halo underneath. Scoped here — does not
          touch globals.css. */}
      <style>{`
        .yj-price-glow { position: relative; }
        .yj-price-glow > button { position: relative; z-index: 1; }
        .yj-price-glow::after {
          content: ''; position: absolute; z-index: 0; pointer-events: none;
          left: -10%; right: -10%; bottom: -3px; height: 100%;
          background: linear-gradient(90deg, var(--grad-green), var(--grad-purple), var(--grad-lime));
          filter: blur(10px); opacity: .55; border-radius: 9999px;
          transition: filter .3s ease, opacity .3s ease, bottom .3s ease;
        }
        .yj-price-glow:hover:not(.is-disabled)::after { filter: blur(13px); opacity: .75; bottom: -4px; }
        .yj-price-glow.is-disabled::after { opacity: 0; }
      `}</style>

      <div className="mx-auto max-w-[1040px]">
        <h2 className="mb-3 text-center text-2xl font-bold tracking-tight md:text-[32px]">
          {t.title}
        </h2>
        <p className="mb-10 text-center text-[var(--muted)] sm:mb-12">{t.subtitle}</p>

        {err && <p className="mb-6 text-center text-sm text-red-600">{err}</p>}

        <div className="grid grid-cols-2 items-stretch gap-4 sm:gap-6 lg:grid-cols-4">
          {ADDON_PACKS.map((pack) => {
            const perBook = pack.priceUsd / pack.books;
            const savePct = Math.round((1 - perBook / baselinePerBook) * 100);
            const isBest = pack.id === bestPackId;
            const isBusy = busy === pack.id;
            const disabled = busy !== null || isPending;

            return (
              <div
                key={pack.id}
                className={`relative flex flex-col rounded-2xl bg-[var(--surface)] p-6 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 sm:p-7${
                  isBest ? ' ring-1 ring-[var(--accent)]/30' : ''
                }`}
              >
                <div className="text-sm font-semibold text-[var(--fg-2)] tabular-nums">
                  {pack.books.toLocaleString(locale)}{' '}
                  {pack.books === 1 ? t.unitSingular : t.unit}
                </div>
                <div className="mt-3 text-5xl font-extrabold leading-none tracking-tight tabular-nums sm:text-6xl">
                  ${pack.priceUsd}
                </div>
                <div className="mt-2.5 text-xs text-[var(--meta)]">
                  ${perBook.toFixed(2)} {t.perBook}
                  {savePct > 0 && (
                    <span className="ml-1 font-semibold text-[var(--accent)]">
                      · -{savePct}%
                    </span>
                  )}
                </div>

                <div className="my-5 h-px w-full bg-[var(--border-soft)]" />

                <ul className="mb-6 space-y-2.5 text-sm text-[var(--fg-2)]">
                  {t.includes.map((line) => (
                    <li key={line} className="flex gap-2">
                      <svg
                        aria-hidden
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="mt-0.5 h-4 w-4 shrink-0"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>

                {isBest ? (
                  <div className={`yj-price-glow mt-auto w-full${disabled ? ' is-disabled' : ''}`}>
                    <button
                      type="button"
                      onClick={() => buy(pack.id)}
                      disabled={disabled}
                      className="w-full rounded-full bg-[var(--fg)] py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                    >
                      {isBusy ? t.redirecting : t.buy}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => buy(pack.id)}
                    disabled={disabled}
                    className="mt-auto w-full rounded-full border border-[var(--fg)] bg-transparent py-2.5 text-sm font-semibold text-[var(--fg)] transition-colors hover:bg-[var(--fg)] hover:text-white disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-[var(--fg)]"
                  >
                    {isBusy ? t.redirecting : t.buy}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {!isPending && !session && (
          <p className="mt-8 text-center text-xs text-[var(--meta)]">{t.loginHint}</p>
        )}
      </div>
    </section>
  );
}
