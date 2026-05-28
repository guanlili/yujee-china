import Link from 'next/link';
import { getMessages } from '@/lib/i18n/messages';
import { type Locale } from '@/lib/i18n/routing';
import { RegisterForm } from './register-form';

export default async function RegisterPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const messages = getMessages(locale).auth;

  return (
    <main className="min-h-screen max-w-md mx-auto px-6 py-16">
      <h1 className="serif text-4xl mb-8">{messages.registerTitle}</h1>
      <RegisterForm messages={messages} />
      <p className="mt-6 text-sm text-[var(--muted)]">
        {messages.switchToLogin}{' '}
        <Link className="underline" href={`/${locale}/login`}>
          {messages.loginAction}
        </Link>
      </p>
    </main>
  );
}
