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
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { locale } = await params;
  const { mode } = await searchParams;
  const messages = getMessages(locale).auth;
  // 国内主通道是手机号。显式 ?mode=email 才落到邮件找回。
  const initialMode = mode === 'email' ? 'email' : 'phone';

  return (
    <AuthPageShell locale={locale}>
      <ForgotPasswordForm messages={messages} locale={locale} initialMode={initialMode} />
    </AuthPageShell>
  );
}
