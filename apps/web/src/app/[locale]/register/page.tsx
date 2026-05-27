import Link from 'next/link';
import { getMessages } from '@/lib/i18n/messages';
import { type Locale } from '@/lib/i18n/routing';

export default async function RegisterPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const messages = getMessages(locale).auth;

  return (
    <main className="min-h-screen max-w-md mx-auto px-6 py-16">
      <h1 className="serif text-4xl mb-8">{messages.registerTitle}</h1>
      <form className="space-y-5" method="post" action="/api/auth/sign-up/email">
        <label className="block">
          <span className="text-sm font-medium">{messages.name}</span>
          <input name="name" type="text" className="mt-2 w-full rounded-lg border border-[var(--border)] p-3" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">{messages.email}</span>
          <input name="email" type="email" required className="mt-2 w-full rounded-lg border border-[var(--border)] p-3" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">{messages.password}</span>
          <input name="password" type="password" required className="mt-2 w-full rounded-lg border border-[var(--border)] p-3" />
        </label>
        <button type="submit" className="w-full rounded-full bg-[var(--accent)] px-6 py-3 text-white">
          {messages.registerAction}
        </button>
      </form>
      <p className="mt-6 text-sm text-[var(--muted)]">
        {messages.switchToLogin}{' '}
        <Link className="underline" href={`/${locale}/login`}>
          {messages.loginAction}
        </Link>
      </p>
    </main>
  );
}
