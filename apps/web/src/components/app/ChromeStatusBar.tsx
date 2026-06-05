'use client';

import Link from 'next/link';
import type { Locale } from '@/lib/i18n/routing';
import { CHROME_PILL_BUTTON_CLASS } from './chromeStyles';
import { LanguageSwitcher } from './LanguageSwitcher';
import { SessionControls } from './SessionControls';

interface Props {
  locale: Locale;
  className?: string;
  showPricing?: boolean;
}

const LOGIN_LABELS: Record<Locale, string> = {
  en: 'Log in',
  zh: '登录',
};

const PRICING_LABELS: Record<Locale, string> = {
  en: 'Pricing',
  zh: '定价',
};

const LOGIN_BUTTON_CLASS =
  'inline-flex rounded-full bg-[var(--fg)] px-5 py-2 text-[var(--text-sm)] font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5';

export function ChromeStatusBar({ locale, className = '', showPricing = false }: Props) {
  return (
    <div className={`flex shrink-0 items-center gap-2 ${className}`}>
      {showPricing && (
        <Link
          href={`/${locale}/credits`}
          className={`hidden sm:inline-flex ${CHROME_PILL_BUTTON_CLASS}`}
        >
          {PRICING_LABELS[locale]}
        </Link>
      )}
      <LanguageSwitcher locale={locale} />
      <SessionControls
        locale={locale}
        loginLabel={LOGIN_LABELS[locale]}
        loginClassName={LOGIN_BUTTON_CLASS}
        creditsClassName="hidden sm:contents"
        loadingClassName="h-9 w-[82px] rounded-full bg-[#ececec] sm:w-[142px]"
      />
    </div>
  );
}
