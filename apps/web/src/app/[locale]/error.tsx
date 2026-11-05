'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Brand, BrandMark } from '@/components/app/Brand';
import { getMessages } from '@/lib/i18n/messages';
import { detectLocale } from '@/lib/i18n/routing';
import { AUTH_BACKGROUND } from './auth-styles';

/**
 * [locale] 段错误边界:任何 server/client 组件在该段内抛错都会落到这里。
 * - 错误只 console.error 上报,UI 不展示堆栈、digest 或任何内部细节;
 * - 文案走项目自有的 getMessages(locale)(根 layout 没有挂 NextIntlClientProvider,
 *   useTranslations 不可用),locale 从 pathname 首段解析;
 * - reset() 重渲染该段,回到出错前的状态。
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  const locale = detectLocale(pathname);
  const t = getMessages(locale).errorPage;

  useEffect(() => {
    // 只上报,不向外暴露 message/stack(可能含路径、内部服务信息)。
    console.error('[locale-error]', error);
  }, [error]);

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ background: AUTH_BACKGROUND }}
    >
      <header className="flex items-center justify-between px-7 py-5">
        <Brand href={`/${locale}`} />
      </header>

      <main className="flex flex-1 items-center justify-center px-5 pb-16 pt-6">
        <div className="w-full max-w-[420px] rounded-[var(--radius-lg)] bg-[var(--surface)] p-6 pb-7 text-center shadow-[var(--shadow-card)] sm:px-9 sm:pb-8 sm:pt-10">
          <BrandMark size={34} alt="Yujee" className="mx-auto mb-[18px]" />
          <h1
            className="mb-2 text-[26px] font-extrabold tracking-[-0.02em] text-[var(--fg)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {t.title}
          </h1>
          <p className="mb-7 text-[var(--fg-2)] text-[var(--text-base)]">{t.body}</p>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={reset}
              className="w-full rounded-[var(--radius-pill)] bg-[var(--accent)] px-5 py-3 text-[15px] font-semibold text-[var(--accent-on)] shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-colors hover:bg-[var(--accent-hover)] focus:outline-none focus:shadow-[0_0_0_3px_rgba(19,184,166,0.18)]"
            >
              {t.retry}
            </button>
            <Link
              href={`/${locale}`}
              className="w-full rounded-[var(--radius-pill)] border border-[var(--border-soft)] bg-[var(--surface)] px-5 py-3 text-[15px] font-semibold text-[var(--fg-2)] transition-colors hover:bg-black/[0.03]"
            >
              {t.backHome}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
