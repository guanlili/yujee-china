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
  creditsClassName?: string;
  loadingClassName?: string;
}

export function SessionControls({
  locale,
  loginLabel,
  loginClassName,
  creditsClassName = 'contents',
  loadingClassName = 'h-9 w-[142px] rounded-full bg-[#ececec]',
}: Props) {
  const { user, balance, plan, loading } = useChromeSession();

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
      <span className={creditsClassName}>
        <CreditsPill balance={balance} plan={plan} locale={locale} />
      </span>
      <UserMenu user={user} plan={plan} locale={locale} />
    </>
  );
}
