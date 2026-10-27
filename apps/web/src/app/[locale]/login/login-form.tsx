'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth/client';
import { normalizePhoneNumber } from '@/lib/auth/phone';
import { safeAuthRedirect } from '@/lib/auth/redirect';
import type { AppMessages } from '@/lib/i18n/messages';

type AuthMessages = AppMessages['auth'];

// The login form must run client-side: better-auth's /sign-in/email returns
// JSON ({ redirect:false, token }), not a 3xx. A native <form> POST therefore
// navigated the browser onto the raw JSON response instead of into the app.
// We call the better-auth client and route on success.
export function LoginForm({
  messages,
  locale,
  from,
  appleEnabled = false,
}: {
  messages: AuthMessages;
  locale: string;
  from?: string;
  appleEnabled?: boolean;
}) {
  const router = useRouter();
  // 手机号登录是免验证期的主入口(邮箱注册卡验证邮件);邮箱登录保留给存量账号。
  const [mode, setMode] = useState<'none' | 'phone' | 'email'>('none');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dest = safeAuthRedirect(from, `/${locale}/my-albums`);

  const onGoogle = async () => {
    setBusy(true);
    setError(null);
    const { error: socialError } = await authClient.signIn.social({
      provider: 'google',
      callbackURL: dest,
    });
    if (socialError) {
      setError(messages.googleError);
      setBusy(false);
    }
  };

  const onApple = async () => {
    setBusy(true);
    setError(null);
    const { error: socialError } = await authClient.signIn.social({
      provider: 'apple',
      callbackURL: dest,
    });
    if (socialError) {
      setError(messages.appleError);
      setBusy(false);
    }
  };

  const routeIn = () => {
    router.push(dest);
    router.refresh();
  };

  const onPhoneSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // /sign-in/phone-number 是 phoneNumber 精确匹配查询,注册端落库前归一过;这里
    // 发原始输入,「+86 138…」注册、「138…」登录就会查无此人。与服务端共用同一
    // 归一函数,归一不合法(过短/含字母)时仍发原值,由服务端按凭据错误兜底。
    const { error: signInError } = await authClient.signIn.phoneNumber({
      phoneNumber: normalizePhoneNumber(identifier) || identifier,
      password,
    });
    if (signInError) {
      setError(messages.loginError);
      setBusy(false);
      return;
    }
    routeIn();
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await authClient.signIn.email({ email: identifier, password, callbackURL: dest });
    if (signInError) {
      setError(messages.loginError);
      setBusy(false);
      return;
    }
    routeIn();
  };

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onGoogle}
        disabled={busy}
        className="flex w-full items-center justify-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-3.5 text-[15px] font-semibold text-[var(--fg)] shadow-[var(--shadow-card)] transition-[transform,box-shadow] duration-[var(--motion-fast)] hover:-translate-y-px hover:shadow-[var(--shadow-card-hover)] disabled:opacity-50"
      >
        <GoogleIcon />
        <span>{messages.continueWithGoogle}</span>
      </button>

      {appleEnabled && (
        <button
          type="button"
          onClick={onApple}
          disabled={busy}
          className="mt-3 flex w-full items-center justify-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-3.5 text-[15px] font-semibold text-[var(--fg)] shadow-[var(--shadow-card)] transition-[transform,box-shadow] duration-[var(--motion-fast)] hover:-translate-y-px hover:shadow-[var(--shadow-card-hover)] disabled:opacity-50"
        >
          <AppleIcon />
          <span>{messages.continueWithApple}</span>
        </button>
      )}

      <div className="my-[22px] flex items-center gap-3.5 text-[12px] text-[var(--meta)] before:h-px before:flex-1 before:bg-[var(--border-soft)] after:h-px after:flex-1 after:bg-[var(--border-soft)]">
        <span>{messages.or}</span>
      </div>

      {mode === 'none' && (
        <>
          <button
            type="button"
            onClick={() => setMode('phone')}
            className="flex w-full items-center justify-center gap-2.5 rounded-full border border-[var(--border)] bg-transparent px-5 py-3 text-[15px] font-medium text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:border-[var(--muted)] hover:bg-[var(--bg)]"
          >
            <PhoneIcon />
            <span>{messages.continueWithPhone}</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('email')}
            className="mt-2.5 flex w-full items-center justify-center gap-2.5 rounded-full border border-[var(--border)] bg-transparent px-5 py-3 text-[15px] font-medium text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:border-[var(--muted)] hover:bg-[var(--bg)]"
          >
            <MailIcon />
            <span>{messages.continueWithEmail}</span>
          </button>
        </>
      )}

      {mode === 'phone' && (
        <form className="flex flex-col gap-3.5" onSubmit={onPhoneSubmit}>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-[var(--fg-2)]">{messages.phone}</span>
            <input
              name="phone"
              type="tel"
              required
              autoComplete="tel"
              autoFocus
              inputMode="tel"
              placeholder={messages.phonePlaceholder}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full rounded-full border border-[var(--border-soft)] bg-[var(--surface)] px-[18px] py-3 text-[15px] text-[var(--fg)] shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-[border-color,box-shadow] duration-[var(--motion-fast)] placeholder:text-[var(--meta)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_rgba(19,184,166,0.12)] focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-[var(--fg-2)]">{messages.password}</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder={messages.passwordPlaceholder}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-full border border-[var(--border-soft)] bg-[var(--surface)] px-[18px] py-3 text-[15px] text-[var(--fg)] shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-[border-color,box-shadow] duration-[var(--motion-fast)] placeholder:text-[var(--meta)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_rgba(19,184,166,0.12)] focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="mt-0.5 w-full rounded-full bg-[var(--fg)] px-5 py-3.5 text-[15px] font-semibold text-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-[transform,box-shadow] duration-[var(--motion-fast)] hover:-translate-y-px hover:shadow-[0_3px_10px_rgba(0,0,0,0.18)] disabled:opacity-50"
          >
            {busy ? messages.loading : messages.loginAction}
          </button>
          <button
            type="button"
            onClick={() => setMode('email')}
            className="text-center text-[12px] font-medium text-[var(--muted)] hover:text-[var(--fg-2)] hover:underline"
          >
            {messages.useEmailInstead}
          </button>
        </form>
      )}

      {mode === 'email' && (
        <form className="flex flex-col gap-3.5" onSubmit={onSubmit}>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-[var(--fg-2)]">
              {messages.email}
            </span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full rounded-full border border-[var(--border-soft)] bg-[var(--surface)] px-[18px] py-3 text-[15px] text-[var(--fg)] shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-[border-color,box-shadow] duration-[var(--motion-fast)] placeholder:text-[var(--meta)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_rgba(19,184,166,0.12)] focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="flex items-baseline justify-between text-[13px] font-medium text-[var(--fg-2)]">
              {messages.password}
              <Link
                href={`/${locale}/forgot-password`}
                className="text-[12px] font-normal text-[var(--accent)] hover:underline"
              >
                {messages.forgotPassword}
              </Link>
            </span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder={messages.passwordPlaceholder}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-full border border-[var(--border-soft)] bg-[var(--surface)] px-[18px] py-3 text-[15px] text-[var(--fg)] shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-[border-color,box-shadow] duration-[var(--motion-fast)] placeholder:text-[var(--meta)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_rgba(19,184,166,0.12)] focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="mt-0.5 w-full rounded-full bg-[var(--fg)] px-5 py-3.5 text-[15px] font-semibold text-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-[transform,box-shadow] duration-[var(--motion-fast)] hover:-translate-y-px hover:shadow-[0_3px_10px_rgba(0,0,0,0.18)] disabled:opacity-50"
          >
            {busy ? messages.loading : messages.loginAction}
          </button>
          <button
            type="button"
            onClick={() => setMode('phone')}
            className="text-center text-[12px] font-medium text-[var(--muted)] hover:text-[var(--fg-2)] hover:underline"
          >
            {messages.usePhoneInstead}
          </button>
        </form>
      )}

      {error && <p className="mt-3.5 text-center text-[13px] text-red-600">{error}</p>}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="currentColor" aria-hidden="true">
      <path d="M17.05 12.54c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.01-3.76-2.04-1.6-.16-3.12.94-3.93.94-.81 0-2.06-.92-3.39-.9-1.74.03-3.35 1.01-4.25 2.57-1.81 3.14-.46 7.79 1.3 10.34.86 1.25 1.89 2.65 3.24 2.6 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.39.81 1.4-.02 2.29-1.27 3.14-2.53.99-1.45 1.4-2.85 1.42-2.93-.03-.01-2.73-1.05-2.76-4.16zM14.6 4.98c.71-.87 1.2-2.07 1.06-3.28-1.03.04-2.28.69-3.02 1.55-.66.76-1.24 1.99-1.09 3.16 1.15.09 2.33-.58 3.05-1.43z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 5L2 7" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
