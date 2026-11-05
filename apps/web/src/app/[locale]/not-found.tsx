import Link from 'next/link';
import { Brand, BrandMark } from '@/components/app/Brand';
import { getMessages } from '@/lib/i18n/messages';
import { getRequestLocale } from '@/lib/i18n/server-locale';
import { AUTH_BACKGROUND } from './auth-styles';

/**
 * [locale] 段 404。not-found.tsx 不接收 params,locale 走中间件注入的
 * x-next-intl-locale header(与根 layout 同一条路)。
 */
export default async function LocaleNotFound() {
  const locale = await getRequestLocale();
  const t = getMessages(locale).notFound;

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
          <Link
            href={`/${locale}`}
            className="inline-block w-full rounded-[var(--radius-pill)] bg-[var(--accent)] px-5 py-3 text-[15px] font-semibold text-[var(--accent-on)] shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-colors hover:bg-[var(--accent-hover)]"
          >
            {t.backHome}
          </Link>
        </div>
      </main>
    </div>
  );
}
