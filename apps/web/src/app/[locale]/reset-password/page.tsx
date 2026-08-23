import type { Metadata } from 'next';
import { getMessages } from '@/lib/i18n/messages';
import { type Locale } from '@/lib/i18n/routing';
import { NOINDEX } from '@/lib/seo/metadata';
import { AuthPageShell } from '../auth-shell';
import { ResetPasswordForm } from './reset-password-form';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: getMessages(locale).auth.resetPasswordTitle,
    robots: NOINDEX,
  };
}

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  // better-auth's /reset-password/:token callback lands here with either
  // `token` (it verified) or `error=INVALID_TOKEN` (expired). Both render from
  // the presence of `token` alone, so the error key is not read.
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = await params;
  const { token } = await searchParams;
  const messages = getMessages(locale).auth;

  return (
    <AuthPageShell locale={locale} showLanguageSwitcher={false}>
      <ResetPasswordForm messages={messages} locale={locale} token={token} />
    </AuthPageShell>
  );
}
