import type { Metadata } from 'next';
import { getMessages } from '@/lib/i18n/messages';
import { type Locale } from '@/lib/i18n/routing';
import { NOINDEX } from '@/lib/seo/metadata';
import { AuthPageShell } from '../auth-shell';
import { ForgotPasswordForm } from './forgot-password-form';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: getMessages(locale).auth.forgotPasswordTitle,
    robots: NOINDEX,
  };
}

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const messages = getMessages(locale).auth;

  return (
    <AuthPageShell locale={locale}>
      <ForgotPasswordForm messages={messages} locale={locale} />
    </AuthPageShell>
  );
}
