import { Brand } from '@/components/app/Brand';
import { LanguageSwitcher } from '@/components/app/LanguageSwitcher';
import { type Locale } from '@/lib/i18n/routing';
import { AUTH_BACKGROUND } from './auth-styles';

/**
 * Shared chrome for the password-reset pages. /login and /register still inline
 * their own copy of this markup (they predate it), but all four now share the
 * background and field styles from ./auth-styles.
 */
export function AuthPageShell({
  locale,
  showLanguageSwitcher = true,
  children,
}: {
  locale: Locale;
  /**
   * Off for /reset-password. LanguageSwitcher targets
   * `localizePath(usePathname(), l)`, and usePathname() returns the pathname
   * with no query string — so switching language there silently drops the
   * `?token=`, and a live, unconsumed link renders the "expired" panel.
   */
  showLanguageSwitcher?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col" style={{ background: AUTH_BACKGROUND }}>
      <header className="flex items-center justify-between px-7 py-5">
        <Brand href={`/${locale}`} />
        {showLanguageSwitcher && <LanguageSwitcher locale={locale} />}
      </header>

      <main className="flex flex-1 items-center justify-center px-5 pb-16 pt-6">
        <div className="w-full max-w-[420px] rounded-[var(--radius-lg)] bg-[var(--surface)] p-6 pb-7 shadow-[var(--shadow-card)] sm:px-9 sm:pb-8 sm:pt-10">
          {children}
        </div>
      </main>
    </div>
  );
}
