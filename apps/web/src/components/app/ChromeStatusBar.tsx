'use client';

import Link from 'next/link';
import type { Locale } from '@/lib/i18n/routing';
import { CHROME_PILL_BUTTON_CLASS } from './chromeStyles';
import { LanguageSwitcher } from './LanguageSwitcher';
import { SessionControls, SessionControlsView } from './SessionControls';
import type { ChromeSession } from './useChromeSession';

interface Props {
  locale: Locale;
  className?: string;
  showPricing?: boolean;
  // Whether to render the credits pill (logged-in only). Defaults to true;
  // /create passes false to hide it via AppChrome.
  showCredits?: boolean;
  languageClassName?: string;
  session?: ChromeSession;
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

export function ChromeStatusBar({
  locale,
  className = '',
  showPricing = false,
  showCredits = true,
  languageClassName = '',
  session,
}: Props) {
  const sessionControlsProps = {
    locale,
    loginLabel: LOGIN_LABELS[locale],
    loginClassName: LOGIN_BUTTON_CLASS,
    showCredits,
    creditsClassName: 'hidden sm:contents',
    loadingClassName: 'h-9 w-[82px] rounded-full bg-[#ececec] sm:w-[142px]',
  };

  return (
    <div className={`flex shrink-0 items-center gap-2 ${className}`}>
      {showPricing && (
        // Same-page anchor: both surfaces that opt into showPricing (the landing
        // home and the logged-in /create home) render the #pricing section, so a
        // relative hash scrolls within the current page instead of bouncing to
        // the landing.
        <Link
          href="#pricing"
          className={`hidden sm:inline-flex ${CHROME_PILL_BUTTON_CLASS}`}
        >
          {PRICING_LABELS[locale]}
        </Link>
      )}
      <LanguageSwitcher locale={locale} className={languageClassName} />
      {session ? (
        <SessionControlsView {...sessionControlsProps} session={session} />
      ) : (
        <SessionControls {...sessionControlsProps} />
      )}
    </div>
  );
}
