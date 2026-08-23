'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { BrandMark } from '@/components/app/Brand';
import { AuthHeading } from '../auth-heading';
import { authClient } from '@/lib/auth/client';
import { AUTH_FIELD_CLASS } from '../auth-styles';
import type { AppMessages } from '@/lib/i18n/messages';

type AuthMessages = AppMessages['auth'];

// better-auth answers /request-password-reset with the same 200 whether or not
// the address has an account (deliberate: it must not leak who is registered),
// so the success panel is worded as a conditional and we never branch on it.
export function ForgotPasswordForm({
  messages,
  locale,
}: {
  messages: AuthMessages;
  locale: string;
}) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
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

  if (sentTo) {
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

  return (
    <>
      <div className="mb-7 text-center">
        <BrandMark size={34} alt="Yujee" className="mx-auto mb-[18px]" />
        <AuthHeading>{messages.forgotPasswordTitle}</AuthHeading>
        <p className="text-[var(--text-base)] text-[var(--muted)]">
          {messages.forgotPasswordSubtitle}
        </p>
      </div>

      <form className="flex flex-col gap-[14px]" onSubmit={onSubmit}>
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

      <p className="mt-6 text-center text-[var(--text-sm)] text-[var(--muted)]">
        <Link className="font-semibold text-[var(--fg)] hover:underline" href={`/${locale}/login`}>
          {messages.backToLogin}
        </Link>
      </p>
    </>
  );
}
