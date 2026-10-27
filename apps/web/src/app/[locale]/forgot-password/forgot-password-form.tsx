'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { BrandMark } from '@/components/app/Brand';
import { AuthHeading } from '../auth-heading';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/config/auth';
import { authClient } from '@/lib/auth/client';
import { normalizePhoneNumber } from '@/lib/auth/phone';
import { AUTH_FIELD_CLASS } from '../auth-styles';
import type { AppMessages } from '@/lib/i18n/messages';

type AuthMessages = AppMessages['auth'];
type Mode = 'phone' | 'email';
type PhoneStep = 'request' | 'code' | 'done';

// better-auth answers both reset-request endpoints with the same 200 whether or
// not the account exists (deliberate: it must not leak who is registered), so
// the success copy stays conditional and we never branch on "found".
function isRateLimited(error: { status?: number; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.status === 429) return true;
  return /too many requests/i.test(error.message ?? '');
}

export function ForgotPasswordForm({
  messages,
  locale,
  initialMode,
}: {
  messages: AuthMessages;
  locale: string;
  initialMode: Mode;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [normalizedPhone, setNormalizedPhone] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [phoneStep, setPhoneStep] = useState<PhoneStep>('request');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setResent(false);
  };

  const onEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // redirectTo is where better-auth sends the browser after it has checked the
    // token — and it is the only place the reset mail can learn its language,
    // see localeFromResetUrl in lib/auth/better-auth.ts.
    const { error: resetError } = await authClient.requestPasswordReset({
      email,
      redirectTo: `/${locale}/reset-password`,
    });
    if (resetError) {
      setError(messages.forgotPasswordError);
      setBusy(false);
      return;
    }
    setSentTo(email);
    setBusy(false);
  };

  const requestPhoneCode = async (target: string) => {
    setResent(false);
    const { error: resetError } = await authClient.phoneNumber.requestPasswordReset({
      phoneNumber: target,
    });
    if (resetError) {
      setError(
        isRateLimited(resetError) ? messages.forgotPasswordPhoneRateLimit : messages.forgotPasswordPhoneError,
      );
      return false;
    }
    return true;
  };

  const onPhoneRequest = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const normalized = normalizePhoneNumber(phone);
    if (!normalized) {
      setError(messages.forgotPasswordPhoneInvalid);
      setBusy(false);
      return;
    }
    const ok = await requestPhoneCode(normalized);
    if (ok) {
      setNormalizedPhone(normalized);
      setPhoneStep('code');
      setOtp('');
      setPassword('');
      setConfirm('');
    }
    setBusy(false);
  };

  const onResend = async () => {
    if (!normalizedPhone) return;
    setBusy(true);
    setError(null);
    const ok = await requestPhoneCode(normalizedPhone);
    if (ok) setResent(true);
    setBusy(false);
  };

  const onPhoneReset = async (e: FormEvent) => {
    e.preventDefault();
    if (!normalizedPhone) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(messages.resetPasswordTooShort);
      return;
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      setError(messages.resetPasswordTooLong);
      return;
    }
    if (password !== confirm) {
      setError(messages.resetPasswordMismatch);
      return;
    }
    setBusy(true);
    setError(null);
    const { error: resetError } = await authClient.phoneNumber.resetPassword({
      phoneNumber: normalizedPhone,
      otp: otp.trim(),
      newPassword: password,
    });
    if (resetError) {
      setError(
        isRateLimited(resetError) ? messages.forgotPasswordPhoneRateLimit : messages.forgotPasswordPhoneOtpError,
      );
      setBusy(false);
      return;
    }
    // revokeSessionsOnPasswordReset drops every session, this browser's included.
    setPhoneStep('done');
    setBusy(false);
  };

  if (mode === 'email' && sentTo) {
    return (
      <div className="text-center">
        <BrandMark size={34} alt="Yujee" className="mx-auto mb-[18px]" />
        <AuthHeading>{messages.forgotPasswordSentTitle}</AuthHeading>
        <p className="text-[var(--text-base)] text-[var(--muted)]">
          {messages.forgotPasswordSentLead}
          <br />
          <span className="font-semibold text-[var(--fg)]">{sentTo}</span>
        </p>
        <p className="mt-4 text-[var(--text-base)] text-[var(--fg-2)]">
          {messages.forgotPasswordSentBody}
        </p>
        <p className="mt-3 text-[var(--text-sm)] text-[var(--meta)]">
          {messages.forgotPasswordSentHint}
        </p>
        <p className="mt-6 text-[var(--text-sm)]">
          <Link className="font-semibold text-[var(--fg)] hover:underline" href={`/${locale}/login`}>
            {messages.backToLogin}
          </Link>
        </p>
      </div>
    );
  }

  if (mode === 'phone' && phoneStep === 'done') {
    return (
      <div className="text-center">
        <BrandMark size={34} alt="Yujee" className="mx-auto mb-[18px]" />
        <AuthHeading>{messages.resetPasswordDoneTitle}</AuthHeading>
        <p className="text-[var(--text-base)] text-[var(--muted)]">
          {messages.resetPasswordDoneBody}
        </p>
        <p className="mt-6 text-[var(--text-sm)]">
          <Link
            className="font-semibold text-[var(--fg)] hover:underline"
            href={`/${locale}/login?mode=phone`}
          >
            {messages.backToLogin}
          </Link>
        </p>
      </div>
    );
  }

  const title = mode === 'phone' && phoneStep === 'code'
    ? messages.forgotPasswordPhoneCodeTitle
    : messages.forgotPasswordTitle;
  const subtitle = mode === 'phone'
    ? phoneStep === 'code'
      ? messages.forgotPasswordPhoneCodeBody
      : messages.forgotPasswordPhoneSubtitle
    : messages.forgotPasswordSubtitle;

  return (
    <>
      <div className="mb-7 text-center">
        <BrandMark size={34} alt="Yujee" className="mx-auto mb-[18px]" />
        <AuthHeading>{title}</AuthHeading>
        <p className="text-[var(--text-base)] text-[var(--muted)]">{subtitle}</p>
      </div>

      {phoneStep === 'request' && (
        <div className="mb-5 grid grid-cols-2 rounded-full border border-[var(--border)] p-1">
          <button
            type="button"
            onClick={() => switchMode('phone')}
            aria-pressed={mode === 'phone'}
            className={
              mode === 'phone'
                ? 'rounded-full bg-[var(--fg)] py-2 text-[var(--text-sm)] font-semibold text-white'
                : 'rounded-full py-2 text-[var(--text-sm)] font-medium text-[var(--muted)]'
            }
          >
            {messages.phone}
          </button>
          <button
            type="button"
            onClick={() => switchMode('email')}
            aria-pressed={mode === 'email'}
            className={
              mode === 'email'
                ? 'rounded-full bg-[var(--fg)] py-2 text-[var(--text-sm)] font-semibold text-white'
                : 'rounded-full py-2 text-[var(--text-sm)] font-medium text-[var(--muted)]'
            }
          >
            {messages.email}
          </button>
        </div>
      )}

      {mode === 'email' ? (
        <form className="flex flex-col gap-[14px]" onSubmit={onEmailSubmit}>
          <label className="flex flex-col gap-[7px]">
            <span className="text-[var(--text-sm)] font-medium text-[var(--fg-2)]">
              {messages.email}
            </span>
            <input
              name="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={AUTH_FIELD_CLASS}
            />
          </label>
          {error && <p className="text-[var(--text-sm)] text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-0.5 w-full rounded-[var(--radius-pill)] bg-[var(--fg)] px-5 py-[13px] text-[var(--text-base)] font-semibold text-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-transform duration-[var(--motion-fast)] hover:-translate-y-px disabled:opacity-40"
          >
            {busy ? messages.loading : messages.forgotPasswordAction}
          </button>
        </form>
      ) : phoneStep === 'request' ? (
        <form className="flex flex-col gap-[14px]" onSubmit={onPhoneRequest}>
          <label className="flex flex-col gap-[7px]">
            <span className="text-[var(--text-sm)] font-medium text-[var(--fg-2)]">
              {messages.phone}
            </span>
            <input
              name="phone"
              type="tel"
              required
              autoFocus
              inputMode="tel"
              autoComplete="tel"
              placeholder={messages.phonePlaceholder}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={AUTH_FIELD_CLASS}
            />
          </label>
          {error && <p className="text-[var(--text-sm)] text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-0.5 w-full rounded-[var(--radius-pill)] bg-[var(--fg)] px-5 py-[13px] text-[var(--text-base)] font-semibold text-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-transform duration-[var(--motion-fast)] hover:-translate-y-px disabled:opacity-40"
          >
            {busy ? messages.loading : messages.forgotPasswordPhoneAction}
          </button>
        </form>
      ) : (
        <form className="flex flex-col gap-[14px]" onSubmit={onPhoneReset}>
          <p className="text-center text-[var(--text-sm)] font-semibold text-[var(--fg)]">
            {normalizedPhone}
          </p>
          <label className="flex flex-col gap-[7px]">
            <span className="text-[var(--text-sm)] font-medium text-[var(--fg-2)]">
              {messages.forgotPasswordPhoneOtp}
            </span>
            <input
              name="otp"
              type="text"
              required
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder={messages.forgotPasswordPhoneOtpPlaceholder}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              className={AUTH_FIELD_CLASS}
            />
          </label>
          <label className="flex flex-col gap-[7px]">
            <span className="text-[var(--text-sm)] font-medium text-[var(--fg-2)]">
              {messages.newPassword}
            </span>
            <input
              name="newPassword"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={AUTH_FIELD_CLASS}
            />
          </label>
          <label className="flex flex-col gap-[7px]">
            <span className="text-[var(--text-sm)] font-medium text-[var(--fg-2)]">
              {messages.confirmPassword}
            </span>
            <input
              name="confirmPassword"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={AUTH_FIELD_CLASS}
            />
          </label>
          {resent && (
            <p className="text-[var(--text-sm)] text-[var(--fg-2)]">{messages.forgotPasswordPhoneResent}</p>
          )}
          {error && <p className="text-[var(--text-sm)] text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-0.5 w-full rounded-[var(--radius-pill)] bg-[var(--fg)] px-5 py-[13px] text-[var(--text-base)] font-semibold text-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-transform duration-[var(--motion-fast)] hover:-translate-y-px disabled:opacity-40"
          >
            {busy ? messages.loading : messages.resetPasswordAction}
          </button>
          <button
            type="button"
            onClick={onResend}
            disabled={busy}
            className="text-center text-[var(--text-sm)] font-medium text-[var(--muted)] hover:text-[var(--fg-2)] hover:underline disabled:opacity-40"
          >
            {messages.forgotPasswordPhoneResend}
          </button>
          <button
            type="button"
            onClick={() => {
              setPhoneStep('request');
              setError(null);
              setResent(false);
            }}
            className="text-center text-[var(--text-sm)] font-medium text-[var(--muted)] hover:text-[var(--fg-2)] hover:underline"
          >
            {messages.forgotPasswordPhoneChangeNumber}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-[var(--text-sm)] text-[var(--muted)]">
        <Link className="font-semibold text-[var(--fg)] hover:underline" href={`/${locale}/login`}>
          {messages.backToLogin}
        </Link>
      </p>
    </>
  );
}
