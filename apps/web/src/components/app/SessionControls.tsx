'use client';

import Link from 'next/link';
import type { Locale } from '@/lib/i18n/routing';
import { UserMenu } from './UserMenu';
import { useChromeSession } from './useChromeSession';

interface Props {
  locale: Locale;
  loginLabel: string;
  loginClassName: string;
  loadingClassName?: string;
}

interface SessionControlsViewProps extends Props {
  session: ReturnType<typeof useChromeSession>;
}

export function SessionControls({
  locale,
  loginLabel,
  loginClassName,
  loadingClassName = 'h-9 w-[142px] rounded-full bg-[#ececec]',
}: Props) {
  return (
    <SessionControlsView
      locale={locale}
      loginLabel={loginLabel}
      loginClassName={loginClassName}
      loadingClassName={loadingClassName}
      session={useChromeSession()}
    />
  );
}

export function SessionControlsView({
  locale,
  loginLabel,
  loginClassName,
  loadingClassName = 'h-9 w-[142px] rounded-full bg-[#ececec]',
  session,
}: SessionControlsViewProps) {
  const { user, plan, loading } = session;

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

  return <UserMenu user={user} plan={plan} locale={locale} />;
}
