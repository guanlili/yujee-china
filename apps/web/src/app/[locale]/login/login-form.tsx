'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth/client';
import { normalizePhoneNumber } from '@/lib/auth/phone';
import { authHrefWithFrom, safeAuthRedirect } from '@/lib/auth/redirect';
import type { AppMessages } from '@/lib/i18n/messages';

type AuthMessages = AppMessages['auth'];

// 429 判定与找回页同款:发码/验码被应用层或阿里云频控拦下时,统一展示
// 「请求过于频繁」而不是吓人的失败文案。
function isRateLimited(error: { status?: number; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.status === 429) return true;
  return /too many requests/i.test(error.message ?? '');
}

// The login form must run client-side: better-auth's /sign-in/email returns
// JSON ({ redirect:false, token }), not a 3xx. A native <form> POST therefore
// navigated the browser onto the raw JSON response instead of into the app.
// We call the better-auth client and route on success.
export function LoginForm({
  messages,
  locale,
  from,
  appleEnabled = false,
  initialMode = 'none',
}: {
  messages: AuthMessages;
  locale: string;
  from?: string;
  appleEnabled?: boolean;
  initialMode?: 'none' | 'phone' | 'email';
}) {
  const router = useRouter();
  // 手机号登录是主入口(密码/验证码两种子模式);邮箱登录保留给存量账号。
  const [mode, setMode] = useState<'none' | 'phone' | 'email'>(initialMode);
  const [phoneMethod, setPhoneMethod] = useState<'password' | 'otp'>('password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  // 未注册号走验证码登录:后端发码端点静默 200(D1 防枚举),用户点验码拿到
  // OTP_NOT_FOUND —— 这里引导去注册(与注册页的已注册冲突面板对称)。
  const [notRegistered, setNotRegistered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dest = safeAuthRedirect(from, `/${locale}/my-albums`);
  const registerHref = authHrefWithFrom(`/${locale}/register`, from);

  // 60s 重发冷却(与找回页同款交互):后端对同一号码也有 60s 硬限,这里只是
  // 不让用户白白把 429 撞在脸上。
  useEffect(() => {
    if (otpCooldown === 0) return;
    const timer = setTimeout(() => setOtpCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [otpCooldown]);

  // 国内版只保留邮箱 + 手机号登录(2026-10-27 起);Google 入口已随 provider
  // 一起移除,Apple 维持「配了才显示」,别在它前面再补别的社交按钮。
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

  const sendLoginCode = async () => {
    const normalized = normalizePhoneNumber(identifier);
    if (!normalized) {
      setError(messages.forgotPasswordPhoneInvalid);
      return;
    }
    setBusy(true);
    setError(null);
    setNotRegistered(false);
    const { error: sendError } = await authClient.phoneNumber.sendOtp({ phoneNumber: normalized });
    if (sendError) {
      setError(isRateLimited(sendError) ? messages.phoneOtpRateLimit : messages.phoneOtpSendError);
      setBusy(false);
      return;
    }
    // 未注册号这里也是 200(服务端静默不发码):用户下一秒验码时会拿到
    // OTP_NOT_FOUND,由 notRegistered 面板接住引导注册。
    setOtpSent(true);
    setOtpCooldown(60);
    setBusy(false);
  };

  const onOtpSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const normalized = normalizePhoneNumber(identifier);
    if (!normalized) {
      setError(messages.forgotPasswordPhoneInvalid);
      return;
    }
    setBusy(true);
    setError(null);
    setNotRegistered(false);
    // 验码登录:已注册用户验码通过即置 phoneNumberVerified 并种会话(顺带把
    // 免验证期的存量账号洗成 verified);游客 session 会被服务端并号。
    const { error: verifyError } = await authClient.phoneNumber.verify({
      phoneNumber: normalized,
      code: otp.trim(),
    });
    if (verifyError) {
      if (verifyError.code === 'OTP_NOT_FOUND' || /otp not found/i.test(verifyError.message ?? '')) {
        setNotRegistered(true);
      } else {
        setError(isRateLimited(verifyError) ? messages.phoneOtpRateLimit : messages.phoneOtpError);
      }
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

  const fieldClass =
    'w-full rounded-full border border-[var(--border-soft)] bg-[var(--surface)] px-[18px] py-3 text-[15px] text-[var(--fg)] shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-[border-color,box-shadow] duration-[var(--motion-fast)] placeholder:text-[var(--meta)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_rgba(19,184,166,0.12)] focus:outline-none';
  const submitClass =
    'mt-0.5 w-full rounded-full bg-[var(--fg)] px-5 py-3.5 text-[15px] font-semibold text-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-[transform,box-shadow] duration-[var(--motion-fast)] hover:-translate-y-px hover:shadow-[0_3px_10px_rgba(0,0,0,0.18)] disabled:opacity-50';

  return (
    <div className="flex flex-col">
      {appleEnabled && (
        <>
          <button
            type="button"
            onClick={onApple}
            disabled={busy}
            className="flex w-full items-center justify-center gap-3 rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-3.5 text-[15px] font-semibold text-[var(--fg)] shadow-[var(--shadow-card)] transition-[transform,box-shadow] duration-[var(--motion-fast)] hover:-translate-y-px hover:shadow-[var(--shadow-card-hover)] disabled:opacity-50"
          >
            <AppleIcon />
            <span>{messages.continueWithApple}</span>
          </button>

          <div className="my-[22px] flex items-center gap-3.5 text-[12px] text-[var(--meta)] before:h-px before:flex-1 before:bg-[var(--border-soft)] after:h-px after:flex-1 after:bg-[var(--border-soft)]">
            <span>{messages.or}</span>
          </div>
        </>
      )}

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
        <div className="flex flex-col gap-3.5">
          {/* 子模式切换:密码登录 | 验证码登录(新增能力,不是替换)。 */}
          <div className="grid grid-cols-2 rounded-full border border-[var(--border)] p-1">
            <button
              type="button"
              onClick={() => {
                setPhoneMethod('password');
                setError(null);
              }}
              aria-pressed={phoneMethod === 'password'}
              className={
                phoneMethod === 'password'
                  ? 'rounded-full bg-[var(--fg)] py-2 text-[13px] font-semibold text-white'
                  : 'rounded-full py-2 text-[13px] font-medium text-[var(--muted)]'
              }
            >
              {messages.phonePasswordLogin}
            </button>
            <button
              type="button"
              onClick={() => {
                setPhoneMethod('otp');
                setError(null);
                setNotRegistered(false);
              }}
              aria-pressed={phoneMethod === 'otp'}
              className={
                phoneMethod === 'otp'
                  ? 'rounded-full bg-[var(--fg)] py-2 text-[13px] font-semibold text-white'
                  : 'rounded-full py-2 text-[13px] font-medium text-[var(--muted)]'
              }
            >
              {messages.phoneOtpLogin}
            </button>
          </div>

          {phoneMethod === 'password' ? (
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
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="flex items-baseline justify-between text-[13px] font-medium text-[var(--fg-2)]">
                  {messages.password}
                  <Link
                    href={`/${locale}/forgot-password?mode=phone`}
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
                  className={fieldClass}
                />
              </label>
              <button type="submit" disabled={busy} className={submitClass}>
                {busy ? messages.loading : messages.loginAction}
              </button>
            </form>
          ) : (
            <form className="flex flex-col gap-3.5" onSubmit={onOtpSubmit}>
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
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    setOtpSent(false);
                  }}
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-[var(--fg-2)]">{messages.phoneOtpLabel}</span>
                <div className="flex gap-2">
                  <input
                    name="otp"
                    type="text"
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder={messages.phoneOtpPlaceholder}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    className={fieldClass}
                  />
                  <button
                    type="button"
                    onClick={sendLoginCode}
                    disabled={busy || otpCooldown > 0}
                    className="shrink-0 rounded-full border border-[var(--border)] px-4 text-[13px] font-semibold text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:border-[var(--muted)] hover:bg-[var(--bg)] disabled:opacity-50"
                  >
                    {otpCooldown > 0 ? `${otpCooldown}s` : messages.phoneSendCode}
                  </button>
                </div>
              </label>
              {otpSent && !notRegistered && (
                <p className="text-[12px] text-[var(--meta)]">{messages.phoneOtpSent}</p>
              )}
              {notRegistered && (
                <div className="flex flex-col gap-2 rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
                  <p className="text-[13px] font-semibold text-[var(--fg)]">{messages.phoneNotRegistered}</p>
                  <p className="text-[13px] text-[var(--muted)]">{messages.phoneNotRegisteredHint}</p>
                  {/* registerHref 继续携带 from:游客从相册被拦来登录时,注册后仍回跳原相册。 */}
                  <Link className="text-[13px] font-semibold text-[var(--fg)] hover:underline" href={registerHref}>
                    {messages.signUpFree} →
                  </Link>
                </div>
              )}
              <button type="submit" disabled={busy} className={submitClass}>
                {busy ? messages.loading : messages.loginAction}
              </button>
            </form>
          )}

          <button
            type="button"
            onClick={() => setMode('email')}
            className="text-center text-[12px] font-medium text-[var(--muted)] hover:text-[var(--fg-2)] hover:underline"
          >
            {messages.useEmailInstead}
          </button>
        </div>
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
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="flex items-baseline justify-between text-[13px] font-medium text-[var(--fg-2)]">
              {messages.password}
              <Link
                href={`/${locale}/forgot-password?mode=email`}
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
              className={fieldClass}
            />
          </label>
          <button type="submit" disabled={busy} className={submitClass}>
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
