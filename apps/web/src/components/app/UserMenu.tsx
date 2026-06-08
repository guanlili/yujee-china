'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/lib/i18n/routing';
import { getMessages } from '@/lib/i18n/messages';
import { signOut } from '@/lib/auth/client';
import type { ChromeUser } from './useChromeSession';

interface Props {
  user: ChromeUser | null;
  plan: string;
  locale: Locale;
  onSignOut?: () => void;
}

export function UserMenu({ user, plan, locale, onSignOut }: Props) {
  const router = useRouter();
  const c = getMessages(locale).dashboard.chrome;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const goPricing = () => {
    setOpen(false);
    router.push(`/${locale}/credits`);
  };

  const handleSignOut = async () => {
    setOpen(false);
    if (onSignOut) return onSignOut();
    await signOut();
    router.push(`/${locale}/login`);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={c.accountMenu}
        className="flex items-center rounded-full p-0.5 transition-shadow hover:shadow-[0_0_0_3px_rgba(0,0,0,0.06)]"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--text-sm)] font-bold text-[var(--surface)]">
          {user?.avatarInitial ?? '·'}
        </span>
      </button>
      {open && (
        <div className="absolute top-[calc(100%+8px)] right-0 min-w-[240px] rounded-[var(--radius-lg)] bg-[var(--surface)] p-2 shadow-[var(--shadow-card-hover)] z-[200]">
          <div className="border-b border-[var(--border-soft)] px-3 py-3 mb-1">
            <div className="text-[var(--text-base)] font-semibold">{user?.name ?? user?.email ?? ''}</div>
            <div className="mt-0.5 text-[var(--text-xs)] text-[var(--meta)]">{user?.email ?? ''}</div>
          </div>
          <div className="mb-1 flex items-center justify-between px-3 py-2.5">
            <span className="text-[var(--text-sm)] font-medium text-[var(--fg-2)]">{plan}</span>
            <button
              type="button"
              onClick={goPricing}
              className="rounded-full bg-[var(--fg)] px-3.5 py-1 text-[var(--text-xs)] font-semibold text-white shadow-sm transition-transform hover:-translate-y-px"
            >
              {c.upgrade}
            </button>
          </div>
          <button type="button" onClick={goPricing} className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-[var(--text-sm)] text-[var(--fg-2)] transition-colors hover:bg-[var(--bg)]">
            <span className="flex h-[18px] w-[18px] items-center justify-center text-[var(--muted)]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            </span>
            {c.manageSubscription}
          </button>
          <a href="mailto:feedback@yujeeai.com" onClick={() => setOpen(false)} className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-[var(--text-sm)] text-[var(--fg-2)] transition-colors hover:bg-[var(--bg)]">
            <span className="flex h-[18px] w-[18px] items-center justify-center text-[var(--muted)]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            </span>
            {c.feedback}
          </a>
          <div className="my-1 h-px bg-[var(--border-soft)]" />
          <button type="button" onClick={handleSignOut} className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-[var(--text-sm)] text-[#c44] transition-colors hover:bg-[var(--bg)]">
            <span className="flex h-[18px] w-[18px] items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            </span>
            {c.logout}
          </button>
        </div>
      )}
    </div>
  );
}
