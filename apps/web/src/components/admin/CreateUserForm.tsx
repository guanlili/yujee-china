'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';

export function CreateUserForm({ locale }: { locale: Locale }) {
  const t = getMessages(locale).admin.users.create;
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const emailValid = /.+@.+\..+/.test(email.trim());
  const canSubmit = emailValid && password.length >= 8 && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setResult(null);
    setErr(null);
    try {
      const res = await fetch('/api/v1/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          name: name.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setErr(json.error?.message ?? t.error);
        return;
      }
      setResult(t.success.replace('{email}', json.data.email));
      setEmail('');
      setName('');
      setPassword('');
      // Refresh the server-rendered user table so the new user shows.
      router.refresh();
    } catch {
      setErr(t.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-[var(--border)] bg-white p-6 mb-8">
      <h2 className="text-lg font-semibold mb-1">{t.title}</h2>
      <p className="text-sm text-[var(--muted)] mb-4">{t.desc}</p>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 grow min-w-[16rem]">
          <span className="text-sm text-[var(--muted)]">{t.emailLabel}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t.emailPlaceholder}
            autoComplete="off"
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 grow min-w-[10rem]">
          <span className="text-sm text-[var(--muted)]">{t.nameLabel}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.namePlaceholder}
            maxLength={100}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 grow min-w-[12rem]">
          <span className="text-sm text-[var(--muted)]">{t.passwordLabel}</span>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t.passwordPlaceholder}
            autoComplete="off"
            minLength={8}
            maxLength={128}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-mono"
          />
        </label>

        <button
          type="submit"
          disabled={!canSubmit}
          className="shrink-0 rounded-full bg-[var(--accent)] text-white px-5 py-2 text-sm disabled:opacity-40"
        >
          {busy ? t.submitting : t.submit}
        </button>
      </form>

      {result && <p className="mt-4 text-sm text-emerald-700">{result}</p>}
      {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
    </section>
  );
}
