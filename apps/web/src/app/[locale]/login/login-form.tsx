'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth/client';
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
}: {
  messages: AuthMessages;
  locale: string;
  from?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await authClient.signIn.email({ email, password });
    if (signInError) {
      setError(messages.loginError);
      setBusy(false);
      return;
    }
    const dest = from && from.startsWith('/') ? from : `/${locale}/my-albums`;
    router.push(dest);
    router.refresh();
  };

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
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
        {busy ? messages.loading : messages.loginAction}
      </button>
    </form>
  );
}
