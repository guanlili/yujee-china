import Link from 'next/link';
import type { Locale } from '@/lib/i18n/routing';
import { getMessages } from '@/lib/i18n/messages';

export type AppNav = 'home' | 'projects';

interface Props {
  locale: Locale;
  // null highlights nothing — used on marketing surfaces (e.g. /pricing) that
  // aren't one of the app nav destinations.
  activeNav: AppNav | null;
}

const ITEMS: { key: AppNav; href: (l: Locale) => string; labelKey: 'navHome' | 'navProjects'; icon: React.ReactNode }[] = [
  {
    key: 'home',
    href: (l) => `/${l}`,
    labelKey: 'navHome',
    icon: (
      <>
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </>
    ),
  },
  {
    key: 'projects',
    href: (l) => `/${l}/my-albums`,
    labelKey: 'navProjects',
    icon: <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />,
  },
];

export function Sidebar({ locale, activeNav }: Props) {
  const c = getMessages(locale).dashboard.chrome;
  return (
    <aside
      className="fixed left-4 top-1/2 -translate-y-1/2 z-50 flex flex-col items-center gap-1 p-1.5 rounded-full backdrop-blur-xl bg-[rgba(255,255,255,0.45)]"
      style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)' }}
    >
      {ITEMS.map((item) => {
        const active = item.key === activeNav;
        return (
          <Link
            key={item.key}
            href={item.href(locale)}
            aria-label={c[item.labelKey]}
            aria-current={active ? 'page' : undefined}
            className={`group relative flex items-center justify-center w-[38px] h-[38px] rounded-full transition-colors ${
              active ? 'bg-black/[0.08] text-[var(--fg)]' : 'text-[var(--muted)] hover:bg-black/[0.06] hover:text-[var(--fg)]'
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
              {item.icon}
            </svg>
            <span className="pointer-events-none absolute left-[calc(100%+10px)] whitespace-nowrap rounded-full bg-[var(--fg)] px-2.5 py-1 text-[var(--text-xs)] font-medium text-white opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0">
              {c[item.labelKey]}
            </span>
          </Link>
        );
      })}
    </aside>
  );
}
