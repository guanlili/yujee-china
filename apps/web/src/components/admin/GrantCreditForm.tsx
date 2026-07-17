'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';

export function GrantCreditForm({ locale }: { locale: Locale }) {
  const t = getMessages(locale).admin.users.grant;
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const parsedAmount = Number(amount);
  const amountValid = Number.isInteger(parsedAmount) && parsedAmount !== 0;
  const canSubmit = email.trim().length > 0 && amountValid && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setResult(null);
    setErr(null);
    try {
      const res = await fetch('/api/v1/admin/grant-credit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          amount: parsedAmount,
          note: note.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setErr(json.error?.message ?? t.error);
        return;
      }
      setResult(
        t.success
          .replace('{email}', json.data.email)
          .replace('{delta}', json.data.delta > 0 ? `+${json.data.delta}` : String(json.data.delta))
          .replace('{balance}', String(json.data.balanceAfter)),
      );
      setAmount('');
      setNote('');
      // Refresh the server-rendered user table so the new balance shows.
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
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 w-32">
          <span className="text-sm text-[var(--muted)]">{t.amountLabel}</span>
          <input
            type="number"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="100"
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 grow min-w-[12rem]">
          <span className="text-sm text-[var(--muted)]">{t.noteLabel}</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.notePlaceholder}
            maxLength={200}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
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
