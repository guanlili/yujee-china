'use client';

import Link from 'next/link';
import type { Locale } from '@/lib/i18n/routing';
import { CreditsPill } from './CreditsPill';
import { UserMenu } from './UserMenu';
import { useChromeSession } from './useChromeSession';

interface Props {
  locale: Locale;
  loginLabel: string;
  loginClassName: string;
  // Hide the credits pill while keeping login / user menu intact (used by
  // /create). Defaults to true.
  showCredits?: boolean;
  creditsClassName?: string;
  loadingClassName?: string;
}

interface SessionControlsViewProps extends Props {
  session: ReturnType<typeof useChromeSession>;
}

export function SessionControls({
  locale,
  loginLabel,
  loginClassName,
  showCredits = true,
  creditsClassName = 'contents',
  loadingClassName = 'h-9 w-[142px] rounded-full bg-[#ececec]',
}: Props) {
  return (
    <SessionControlsView
      locale={locale}
      loginLabel={loginLabel}
      loginClassName={loginClassName}
      showCredits={showCredits}
      creditsClassName={creditsClassName}
      loadingClassName={loadingClassName}
      session={useChromeSession()}
    />
  );
}

export function SessionControlsView({
  locale,
  loginLabel,
  loginClassName,
  showCredits = true,
  creditsClassName = 'contents',
  loadingClassName = 'h-9 w-[142px] rounded-full bg-[#ececec]',
  session,
}: SessionControlsViewProps) {
  const { user, balance, plan, loading } = session;

  if (loading) {
    return <span aria-hidden="true" className={`inline-flex animate-pulse ${loadingClassName}`} />;
  }

  if (!user) {
    return (
      <Link href={`/${locale}/login`} className={loginClassName}>
        {loginLabel}
      </Link>
    );
  }

  return (
    <>
      {showCredits && (
        <span className={creditsClassName}>
          <CreditsPill balance={balance} plan={plan} locale={locale} />
        </span>
      )}
      <UserMenu user={user} plan={plan} locale={locale} />
    </>
  );
}
