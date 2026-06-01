'use client';

import { useRouter } from 'next/navigation';
import type { Locale } from '@/lib/i18n/routing';
import { getMessages } from '@/lib/i18n/messages';

interface Props {
  balance: number | null;
  plan: string;
  locale: Locale;
}

export function CreditsPill({ balance, plan, locale }: Props) {
  const router = useRouter();
  const c = getMessages(locale).dashboard.chrome;
  return (
    <button
      type="button"
      title={c.creditsPillTitle}
      onClick={() => router.push(`/${locale}/pricing`)}
      className="flex items-center gap-1.5 rounded-full bg-[#ececec] hover:bg-[#e2e2e2] px-3.5 py-1.5 text-[var(--text-sm)] font-medium text-[var(--fg-2)] transition-colors"
    >
      <span className="w-2 h-2 rounded-full bg-[var(--grad-green)] shrink-0" />
      <span>{balance === null ? '—' : balance}</span>
      <span className="font-light text-[var(--border)]">|</span>
      <span className="font-normal text-[var(--muted)]">{plan}</span>
    </button>
  );
}
