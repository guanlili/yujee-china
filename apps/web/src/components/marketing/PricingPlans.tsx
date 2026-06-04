'use client';

import { useState } from 'react';
import {
  ACTIVE_CHECKOUT_PROVIDER,
  PLANS,
  planPriceFor,
  type BillingCycle,
  type PlanId,
} from '@/config/pricing';
import type { MarketingMessages } from '@/messages/marketing';
import type { Locale } from '@/lib/i18n/routing';

interface Props {
  messages: MarketingMessages['pricing'];
  locale: Locale;
}

export function PricingPlans({ messages: m, locale }: Props) {
  const [cycle, setCycle] = useState<BillingCycle>('yearly');
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const subscribe = async (planId: Exclude<PlanId, 'free'>) => {
    setBusy(planId);
    setErr(null);
    try {
      const res = await fetch('/api/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'subscription',
          planId,
          cycle,
          provider: ACTIVE_CHECKOUT_PROVIDER,
          locale,
        }),
      });
      const json = await res.json();
      if (json.ok && json.data?.url) {
        window.location.href = json.data.url;
        return;
      }
      setErr(json.error?.message ?? 'Checkout failed');
    } catch {
      setErr('Checkout failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {err && <p className="mb-6 text-center text-sm text-red-600">{err}</p>}
      <div className="flex justify-center mb-12">
        <div className="inline-flex items-center gap-1 p-1 rounded-full bg-[var(--bg)] border border-[var(--border-soft)]">
          <button
            type="button"
            onClick={() => setCycle('monthly')}
            className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
              cycle === 'monthly' ? 'bg-[var(--surface)] text-[var(--fg)] shadow-sm font-semibold' : 'text-[var(--muted)]'
            }`}
          >
            {m.monthly}
          </button>
          <button
            type="button"
            onClick={() => setCycle('yearly')}
            className={`flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium transition-all ${
              cycle === 'yearly' ? 'bg-[var(--surface)] text-[var(--fg)] shadow-sm font-semibold' : 'text-[var(--muted)]'
            }`}
          >
            <span>{m.yearly}</span>
            <span className="text-[11px] font-bold text-white bg-[var(--grad-green)] px-2 py-0.5 rounded-full whitespace-nowrap">
              {m.save}
            </span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-20 items-stretch">
        {PLANS.map((plan) => {
          const price = planPriceFor(plan, cycle);
          const isFree = plan.id === 'free';
          const planMsg = m.plan[plan.id];
          const ctaLabel = m.cta[plan.id === 'free' ? 'current' : plan.id === 'pro' ? 'pro' : 'studio'];
          const buttonClass = plan.recommended
            ? 'bg-[var(--fg)] text-white shadow-[0_4px_16px_-4px_rgba(140,94,244,0.4)] hover:-translate-y-0.5'
            : isFree
              ? 'bg-transparent text-[var(--muted)] border border-[var(--border-soft)] hover:bg-[var(--bg)] hover:text-[var(--fg)]'
              : 'bg-transparent text-[var(--fg)] border border-[var(--fg)] hover:bg-[var(--fg)] hover:text-white';

          return (
            <div
              key={plan.id}
              className={`relative bg-[var(--surface)] rounded-2xl p-8 flex flex-col shadow-[var(--shadow-card)] hover:-translate-y-0.5 transition-all ${
                plan.recommended ? 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.06),0_0_16px_rgba(140,94,244,0.15)]' : ''
              }`}
            >
              {plan.recommended && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[var(--accent)] text-white text-[11px] font-semibold px-3.5 py-1 rounded-full">
                  {m.recommended}
                </div>
              )}
              <div className="font-bold text-lg tracking-tight mb-1.5">{planMsg.name}</div>
              <div className="text-sm text-[var(--muted)] mb-5 leading-relaxed">{planMsg.desc}</div>

              <div className="flex items-baseline gap-1 mb-1.5">
                <span className="text-[40px] font-extrabold tracking-tighter tabular-nums">
                  {isFree ? m.free : `$${price}`}
                </span>
                {!isFree && <span className="text-sm text-[var(--muted)]">{m.perMonth}</span>}
              </div>
              <div className="flex items-center gap-1.5 text-sm text-[var(--fg-2)] mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--grad-green)]" />
                <span>
                  {isFree && plan.oneTimeCredits
                    ? `${plan.oneTimeCredits.toLocaleString()} ${m.creditsOneTime}`
                    : `${plan.creditsPerMonth.toLocaleString()} ${m.creditsPerMonth}`}
                </span>
              </div>

              <ul className="border-t border-[var(--border-soft)] pt-5 mt-auto mb-5 space-y-2 order-10">
                {plan.featureKeys.map((key) => (
                  <li key={key} className="flex items-start gap-2 text-sm text-[var(--fg-2)]">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 mt-0.5 text-[var(--grad-green)] flex-shrink-0">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>{m.feat[key] ?? key}</span>
                  </li>
                ))}
                {plan.disabledFeatureKeys?.map((key) => (
                  <li key={key} className="flex items-start gap-2 text-sm text-[var(--meta)]">
                    <span className="w-4 h-4 mt-0.5 text-center flex-shrink-0">—</span>
                    <span>{m.feat[key] ?? key}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => {
                  if (plan.id === 'pro' || plan.id === 'studio') void subscribe(plan.id);
                }}
                className={`w-full py-3 rounded-full text-sm font-semibold transition-all order-5 mb-5 ${buttonClass}`}
                disabled={isFree || busy !== null}
              >
                {busy === plan.id ? 'Redirecting...' : ctaLabel}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
