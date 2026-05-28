import Link from 'next/link';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';

export function AdminForbidden({ locale }: { locale: Locale }) {
  const t = getMessages(locale).admin.forbidden;

  return (
    <main className="min-h-screen max-w-md mx-auto px-6 py-32 text-center">
      <h1 className="serif text-3xl mb-3">{t.title}</h1>
      <p className="text-[var(--muted)] mb-8">{t.body}</p>
      <Link
        href={`/${locale}/my-albums`}
        className="inline-block rounded-full bg-[var(--accent)] text-white px-6 py-2.5 text-sm"
      >
        {t.home}
      </Link>
    </main>
  );
}
