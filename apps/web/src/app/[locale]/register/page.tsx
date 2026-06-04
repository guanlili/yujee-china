import { Brand } from '@/components/app/Brand';
import { getMessages } from '@/lib/i18n/messages';
import { type Locale } from '@/lib/i18n/routing';
import { RegisterForm } from './register-form';

// Layered radial wash mirrors design-v1/design/login.html so /register and
// /login share one auth surface.
const authBackground =
  'radial-gradient(ellipse 80% 60% at 0% 0%, rgba(23,225,135,0.07) 0%, transparent 70%),' +
  'radial-gradient(ellipse 60% 70% at 50% 100%, rgba(140,94,244,0.06) 0%, transparent 70%),' +
  'radial-gradient(ellipse 70% 50% at 100% 20%, rgba(218,244,94,0.06) 0%, transparent 70%),' +
  'var(--bg)';

export default async function RegisterPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const messages = getMessages(locale).auth;

  return (
    <div className="flex min-h-screen flex-col" style={{ background: authBackground }}>
      <header className="flex items-center justify-between px-7 py-5">
        <Brand href={`/${locale}`} />
      </header>

      <main className="flex flex-1 items-center justify-center px-5 pb-16 pt-6">
        <div className="w-full max-w-[420px] rounded-[var(--radius-lg)] bg-[var(--surface)] px-9 pb-8 pt-10 shadow-[var(--shadow-card)]">
          <RegisterForm messages={messages} locale={locale} />
        </div>
      </main>
    </div>
  );
}
