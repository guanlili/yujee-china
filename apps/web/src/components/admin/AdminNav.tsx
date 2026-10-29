import Link from 'next/link';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';

type Tab = 'overview' | 'users' | 'invites' | 'analytics' | 'settings' | 'changelog';

const TABS: { key: Tab; href: string }[] = [
  { key: 'overview', href: '' },
  { key: 'users', href: '/users' },
  { key: 'invites', href: '/invite-codes' },
  { key: 'analytics', href: '/analytics' },
  { key: 'settings', href: '/settings' },
  { key: 'changelog', href: '/changelog' },
];

interface Props {
  locale: Locale;
  active: Tab;
}

export function AdminNav({ locale, active }: Props) {
  const t = getMessages(locale).admin.nav;

  return (
    <nav className="flex items-center gap-1 border-b border-[var(--border)] mb-10 text-sm">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`/${locale}/admin${tab.href}`}
          className={`px-4 py-3 -mb-px border-b-2 ${
            active === tab.key
              ? 'border-[var(--accent)] text-[var(--accent)] font-medium'
              : 'border-transparent text-[var(--muted)] hover:text-current'
          }`}
        >
          {t[tab.key]}
        </Link>
      ))}
      <Link
        href={`/${locale}/my-albums`}
        className="ml-auto px-4 py-3 text-[var(--muted)] hover:text-current"
      >
        {t.backToApp}
      </Link>
    </nav>
  );
}
