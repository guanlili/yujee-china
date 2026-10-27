'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { BrandMark } from '@/components/app/Brand';
import { AuthHeading } from '../auth-heading';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/config/auth';
import { AUTH_FIELD_CLASS } from '../auth-styles';
import { authClient } from '@/lib/auth/client';
import type { AppMessages } from '@/lib/i18n/messages';

type AuthMessages = AppMessages['auth'];

/**
 * Landing page for the link in the reset email. The token never reaches this
 * component raw from the mail: better-auth's /reset-password/:token endpoint
 * checks it exists and hasn't expired first, then redirects here with either
 * `?token=` or `?error=INVALID_TOKEN`. An expired token therefore renders the
 * "ask for a new link" panel rather than a form that is guaranteed to fail.
 */
export function ResetPasswordForm({
  messages,
  locale,
  token,
}: {
  messages: AuthMessages;
  locale: string;
  token?: string;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(messages.resetPasswordTooShort);
      return;
    }
    if (password !== confirm) {
      setError(messages.resetPasswordMismatch);
      return;
    }
    setBusy(true);
    setError(null);
    const { error: resetError } = await authClient.resetPassword({
      newPassword: password,
      token,
    });
    if (resetError) {
      setError(messages.resetPasswordError);
      setBusy(false);
      return;
    }
    // revokeSessionsOnPasswordReset drops every session, this browser's included
    // — there is nothing to route into, so we send them back to /login.
    setDone(true);
    setBusy(false);
  };

  if (done) {
    return (
      <div className="text-center">
        <BrandMark size={34} alt="Yujee" className="mx-auto mb-[18px]" />
        <AuthHeading>{messages.resetPasswordDoneTitle}</AuthHeading>
        <p className="text-[var(--text-base)] text-[var(--muted)]">
          {messages.resetPasswordDoneBody}
        </p>
        <p className="mt-6 text-[var(--text-sm)]">
          <Link className="font-semibold text-[var(--fg)] hover:underline" href={`/${locale}/login`}>
            {messages.backToLogin}
          </Link>
        </p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="text-center">
        <BrandMark size={34} alt="Yujee" className="mx-auto mb-[18px]" />
        <AuthHeading>{messages.resetPasswordExpiredTitle}</AuthHeading>
        <p className="text-[var(--text-base)] text-[var(--muted)]">
          {messages.resetPasswordExpiredBody}
        </p>
        <p className="mt-6 text-[var(--text-sm)]">
          <Link
            className="font-semibold text-[var(--fg)] hover:underline"
            href={`/${locale}/forgot-password?mode=email`}
          >
            {messages.resetPasswordRequestNew}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-7 text-center">
        <BrandMark size={34} alt="Yujee" className="mx-auto mb-[18px]" />
        <AuthHeading>{messages.resetPasswordTitle}</AuthHeading>
        <p className="text-[var(--text-base)] text-[var(--muted)]">
          {messages.resetPasswordSubtitle}
        </p>
      </div>

      <form className="flex flex-col gap-[14px]" onSubmit={onSubmit}>
        <label className="flex flex-col gap-[7px]">
          <span className="text-[var(--text-sm)] font-medium text-[var(--fg-2)]">
            {messages.newPassword}
          </span>
          <input
            name="newPassword"
            type="password"
            required
            autoFocus
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
        {error && <p className="text-[var(--text-sm)] text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-0.5 w-full rounded-[var(--radius-pill)] bg-[var(--fg)] px-5 py-[13px] text-[var(--text-base)] font-semibold text-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-transform duration-[var(--motion-fast)] hover:-translate-y-px disabled:opacity-40"
        >
          {busy ? messages.loading : messages.resetPasswordAction}
        </button>
      </form>

      <p className="mt-6 text-center text-[var(--text-sm)] text-[var(--muted)]">
        <Link className="font-semibold text-[var(--fg)] hover:underline" href={`/${locale}/login`}>
          {messages.backToLogin}
        </Link>
      </p>
    </>
  );
}
