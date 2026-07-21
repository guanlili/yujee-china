import type { Metadata } from 'next';
import Link from 'next/link';
import { Brand, BrandMark } from '@/components/app/Brand';
import { LanguageSwitcher } from '@/components/app/LanguageSwitcher';
import { getAppleCredentials } from '@/lib/auth/apple-client-secret';
import { authHrefWithFrom } from '@/lib/auth/redirect';
import { getMessages } from '@/lib/i18n/messages';
import { type Locale } from '@/lib/i18n/routing';
import { NOINDEX } from '@/lib/seo/metadata';
import { LoginForm } from './login-form';

// An auth form has no search value and was previously indexable, inheriting the
// root layout's English marketing title verbatim — on /zh/login too.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: getMessages(locale).auth.loginTitle,
    robots: NOINDEX,
  };
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { locale } = await params;
  const { from } = await searchParams;
  const messages = getMessages(locale).auth;
  const registerHref = authHrefWithFrom(`/${locale}/register`, from);
  // Apple button only renders once all four APPLE_* env vars are configured.
  const appleEnabled = getAppleCredentials() !== null;

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{
        background:
          'radial-gradient(ellipse 80% 60% at 0% 0%, rgba(19,184,166,0.07) 0%, transparent 70%), radial-gradient(ellipse 60% 70% at 50% 100%, rgba(19,184,166,0.06) 0%, transparent 70%), radial-gradient(ellipse 70% 50% at 100% 20%, rgba(218,244,94,0.06) 0%, transparent 70%), var(--bg)',
      }}
    >
      <header className="flex items-center justify-between px-7 py-5">
        <Brand href={`/${locale}`} />
        <LanguageSwitcher locale={locale} />
      </header>

      <main className="flex flex-1 items-center justify-center px-5 pb-16 pt-6">
        <div className="w-full max-w-[420px] rounded-[var(--radius-lg)] bg-[var(--surface)] p-6 pb-7 shadow-[var(--shadow-card)] sm:px-9 sm:pb-8 sm:pt-10">
          <div className="mb-7 text-center">
            <BrandMark size={34} alt="Yujee" className="mx-auto mb-[18px]" />
            <h1
              className="mb-2 text-[32px] font-extrabold tracking-[-0.02em] text-[var(--fg)]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {messages.loginWelcome}
            </h1>
            <p className="text-[15px] text-[var(--muted)]">{messages.loginSubtitle}</p>
          </div>

          <LoginForm messages={messages} locale={locale} from={from} appleEnabled={appleEnabled} />

          <p className="mt-6 text-center text-[13px] text-[var(--muted)]">
            {messages.noAccount}{' '}
            <Link className="font-semibold text-[var(--fg)] hover:underline" href={registerHref}>
              {messages.signUpFree}
            </Link>
          </p>

          <p className="mt-[22px] text-center text-[12px] leading-relaxed text-[var(--meta)]">
            {messages.legalPrefix}{' '}
            <Link className="text-[var(--muted)] underline hover:text-[var(--fg-2)]" href={`/${locale}/terms`}>
              {messages.terms}
            </Link>{' '}
            {messages.legalAnd}{' '}
            <Link className="text-[var(--muted)] underline hover:text-[var(--fg-2)]" href={`/${locale}/privacy`}>
              {messages.privacy}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
