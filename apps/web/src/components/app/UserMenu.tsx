'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { localizePath, type Locale } from '@/lib/i18n/routing';
import { getMessages } from '@/lib/i18n/messages';
import { signOut } from '@/lib/auth/client';
import type { ChromeUser } from './useChromeSession';
import { UserAvatar } from './UserAvatar';

interface Props {
  user: ChromeUser | null;
  locale: Locale;
  onSignOut?: () => void;
  /** 在菜单内渲染 EN/中文 语言切换行。编辑页开(它没有独立的语言切换器);
   *  landing/my-albums 不开(它们在菜单外已有 LanguageSwitcher)。 */
  showLangSwitch?: boolean;
}

export function UserMenu({ user, locale, onSignOut, showLangSwitch = false }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const m = getMessages(locale).dashboard;
  const c = m.chrome;

  // 游客(匿名影子账号):不渲染账号菜单(临时邮箱/积分/登出都没意义),
  // 换成「登录」CTA,带当前路径回跳 —— 登录成功即转正过户,回来继续编辑。
  if (user?.isAnonymous) {
    return (
      <Link
        href={`/${locale}/login?from=${encodeURIComponent(pathname)}`}
        className="rounded-full bg-[var(--fg)] px-4 py-1.5 text-[var(--text-sm)] font-semibold text-white no-underline shadow-sm transition-transform hover:-translate-y-px"
      >
        {c.signIn}
      </Link>
    );
  }
  const balance = user?.creditBalance ?? 0;
  const balanceLabel = `${balance.toLocaleString(locale)} ${
    balance === 1 ? m.credits.unitSingular : m.credits.unit
  }`;
  const [open, setOpen] = useState(false);
  // 反馈弹层:提交到 /api/v1/feedback(落库+转发运营邮箱),替代原 mailto 死链。
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackState, setFeedbackState] = useState<'idle' | 'sending' | 'done' | 'fail'>('idle');
  const ref = useRef<HTMLDivElement>(null);

  const submitFeedback = async () => {
    const message = feedbackText.trim();
    if (!message || feedbackState === 'sending') return;
    setFeedbackState('sending');
    try {
      const res = await fetch('/api/v1/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, page: window.location.pathname }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error('feedback failed');
      setFeedbackState('done');
      setFeedbackText('');
      setTimeout(() => {
        setFeedbackOpen(false);
        setFeedbackState('idle');
      }, 1600);
    } catch {
      setFeedbackState('fail');
    }
  };

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
        <UserAvatar initial={user?.avatarInitial} size={40} />
      </button>
      {open && (
        <div className="absolute top-[calc(100%+8px)] right-0 min-w-[240px] rounded-[var(--radius-lg)] bg-[var(--surface)] p-2 shadow-[var(--shadow-card-hover)] z-[200]">
          <div className="border-b border-[var(--border-soft)] px-3 py-3 mb-1">
            <div className="text-[var(--text-base)] font-semibold">{user?.name ?? user?.email ?? ''}</div>
            <div className="mt-0.5 text-[var(--text-xs)] text-[var(--meta)]">{user?.email ?? ''}</div>
          </div>
          {showLangSwitch && (
            <div className="mb-1 flex gap-1 px-3 py-2">
              {(['en', 'zh'] as const).map((l) => (
                <Link
                  key={l}
                  href={localizePath(pathname, l)}
                  onClick={() => setOpen(false)}
                  className={`flex-1 rounded-[var(--radius-md)] px-2 py-1 text-center text-[var(--text-xs)] no-underline transition-colors ${
                    l === locale
                      ? 'bg-[var(--bg)] font-semibold text-[var(--fg)]'
                      : 'text-[var(--fg-2)] hover:bg-[var(--bg)]'
                  }`}
                >
                  {l === 'zh' ? '中文' : 'EN'}
                </Link>
              ))}
            </div>
          )}
          <div className="mb-1 flex items-center justify-between gap-4 px-3 py-2.5">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--meta)]">
                {c.creditBalance}
              </div>
              <div className="mt-0.5 text-[var(--text-sm)] font-medium text-[var(--fg-2)]">{balanceLabel}</div>
            </div>
            <button
              type="button"
              onClick={goPricing}
              className="rounded-full bg-[var(--fg)] px-3.5 py-1 text-[var(--text-xs)] font-semibold text-white shadow-sm transition-transform hover:-translate-y-px"
            >
              {c.upgrade}
            </button>
          </div>
          <Link href={`/${locale}/my-albums`} onClick={() => setOpen(false)} className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-[var(--text-sm)] text-[var(--fg-2)] transition-colors hover:bg-[var(--bg)]">
            <span className="flex h-[18px] w-[18px] items-center justify-center text-[var(--muted)]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
            </span>
            {m.nav.myAlbums}
          </Link>
          <button type="button" onClick={goPricing} className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-[var(--text-sm)] text-[var(--fg-2)] transition-colors hover:bg-[var(--bg)]">
            <span className="flex h-[18px] w-[18px] items-center justify-center text-[var(--muted)]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            </span>
            {c.manageSubscription}
          </button>
          <Link href={`/${locale}/credits#history`} onClick={() => setOpen(false)} className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-[var(--text-sm)] text-[var(--fg-2)] transition-colors hover:bg-[var(--bg)]">
            <span className="flex h-[18px] w-[18px] items-center justify-center text-[var(--muted)]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M3 3v18h18" /><path d="M7 14l3-3 3 2 5-6" /></svg>
            </span>
            {c.creditHistory}
          </Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setFeedbackOpen(true);
            }}
            className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-[var(--text-sm)] text-[var(--fg-2)] transition-colors hover:bg-[var(--bg)]"
          >
            <span className="flex h-[18px] w-[18px] items-center justify-center text-[var(--muted)]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            </span>
            {c.feedback}
          </button>
          <div className="my-1 h-px bg-[var(--border-soft)]" />
          <button type="button" onClick={handleSignOut} className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-[var(--text-sm)] text-[#c44] transition-colors hover:bg-[var(--bg)]">
            <span className="flex h-[18px] w-[18px] items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            </span>
            {c.logout}
          </button>
        </div>
      )}
      {feedbackOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={() => feedbackState !== 'sending' && setFeedbackOpen(false)}>
          <div
            className="w-full max-w-md rounded-[18px] bg-[var(--surface)] p-5 shadow-[var(--elev-card-hover)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 text-[15px] font-semibold text-[var(--fg)]">{c.feedbackTitle}</div>
            {feedbackState === 'done' ? (
              <div className="py-6 text-center text-[var(--text-sm)] text-[var(--fg-2)]">{c.feedbackDone}</div>
            ) : (
              <>
                <textarea
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  placeholder={c.feedbackPlaceholder}
                  maxLength={2000}
                  rows={5}
                  autoFocus
                  className="w-full resize-none rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--bg)] p-3 text-[var(--text-sm)] text-[var(--fg)] outline-none focus:border-[var(--accent-active)]"
                />
                {feedbackState === 'fail' && (
                  <div className="mt-2 text-[12.5px] text-[#c44]">{c.feedbackFail}</div>
                )}
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={submitFeedback}
                    disabled={feedbackState === 'sending' || !feedbackText.trim()}
                    className="rounded-full bg-[var(--fg)] px-5 py-2 text-[var(--text-sm)] text-white transition-opacity disabled:opacity-40"
                  >
                    {feedbackState === 'sending' ? c.feedbackSending : c.feedbackSubmit}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
