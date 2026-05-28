'use client';

import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth/client';
import type { AppMessages } from '@/lib/i18n/messages';

type AuthMessages = AppMessages['auth'];

// Same reason as LoginForm: /sign-up/email returns JSON, not a redirect. With
// requireEmailVerification the signup does not create a session, so on success
// we show a "check your email" message rather than routing into the app.
export function RegisterForm({ messages }: { messages: AuthMessages }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signUpError } = await authClient.signUp.email({ name, email, password });
    if (signUpError) {
      setError(messages.registerError);
      setBusy(false);
      return;
    }
    setSent(true);
    setBusy(false);
  };

  if (sent) {
    return <p className="text-sm">{messages.verifyEmailSent}</p>;
  }

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <label className="block">
        <span className="text-sm font-medium">{messages.name}</span>
        <input
          name="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-2 w-full rounded-lg border border-[var(--border)] p-3"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium">{messages.email}</span>
        <input
          name="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-2 w-full rounded-lg border border-[var(--border)] p-3"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium">{messages.password}</span>
        <input
          name="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-2 w-full rounded-lg border border-[var(--border)] p-3"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-full bg-[var(--accent)] px-6 py-3 text-white disabled:opacity-40"
      >
        {busy ? messages.loading : messages.registerAction}
      </button>
    </form>
  );
}
