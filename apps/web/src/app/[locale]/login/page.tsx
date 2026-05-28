import Link from 'next/link';
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
    <main className="min-h-screen max-w-md mx-auto px-6 py-16">
      <h1 className="serif text-4xl mb-8">{messages.loginTitle}</h1>
      <LoginForm messages={messages} locale={locale} from={from} />
      <p className="mt-6 text-sm text-[var(--muted)]">
        {messages.switchToRegister}{' '}
        <Link className="underline" href={`/${locale}/register`}>
          {messages.registerAction}
        </Link>
      </p>
    </main>
  );
}
