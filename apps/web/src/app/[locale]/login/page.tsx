import Link from 'next/link';
import { Brand } from '@/components/app/Brand';
import { LanguageSwitcher } from '@/components/app/LanguageSwitcher';
import { getMessages } from '@/lib/i18n/messages';
import { type Locale } from '@/lib/i18n/routing';
import { LoginForm } from './login-form';

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

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{
        background:
          'radial-gradient(ellipse 80% 60% at 0% 0%, rgba(23,225,135,0.07) 0%, transparent 70%), radial-gradient(ellipse 60% 70% at 50% 100%, rgba(140,94,244,0.06) 0%, transparent 70%), radial-gradient(ellipse 70% 50% at 100% 20%, rgba(218,244,94,0.06) 0%, transparent 70%), var(--bg)',
      }}
    >
      <header className="flex items-center justify-between px-7 py-5">
        <Brand href={`/${locale}`} />
        <LanguageSwitcher locale={locale} />
      </header>

      <main className="flex flex-1 items-center justify-center px-5 pb-16 pt-6">
        <div className="w-full max-w-[420px] rounded-[var(--radius-lg)] bg-[var(--surface)] px-9 pb-8 pt-10 shadow-[var(--shadow-card)]">
          <div className="mb-7 text-center">
            <div className="mx-auto mb-[18px] h-12 w-12 rounded-xl bg-gradient-to-br from-[var(--grad-green)] via-[var(--grad-purple)] to-[var(--grad-lime)]" />
            <h1 className="mb-2 text-[32px] font-extrabold tracking-tight text-[var(--fg)]">
              {messages.loginWelcome}
            </h1>
            <p className="text-[15px] text-[var(--muted)]">{messages.loginSubtitle}</p>
          </div>

          <LoginForm messages={messages} locale={locale} from={from} />

          <p className="mt-6 text-center text-[13px] text-[var(--muted)]">
            {messages.noAccount}{' '}
            <Link className="font-semibold text-[var(--fg)] hover:underline" href={`/${locale}/register`}>
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
