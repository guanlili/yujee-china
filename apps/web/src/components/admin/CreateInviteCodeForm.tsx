'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';

export function CreateInviteCodeForm({ locale }: { locale: Locale }) {
  const t = getMessages(locale).admin.invites.form;
  const router = useRouter();

  const [code, setCode] = useState('');
  const [credits, setCredits] = useState('');
  const [expiryDays, setExpiryDays] = useState('30');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const creditsNum = Number(credits);
  const expiryNum = Number(expiryDays);
  const canSubmit =
    code.trim().length > 0 &&
    Number.isInteger(creditsNum) &&
    creditsNum > 0 &&
    Number.isInteger(expiryNum) &&
    expiryNum > 0 &&
    !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setResult(null);
    setErr(null);
    try {
      // 空的总量上限 = 不限总次数(仍每人一次)。
      const trimmedMax = maxRedemptions.trim();
      const res = await fetch('/api/v1/admin/invite-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          credits: creditsNum,
          expiryDays: expiryNum,
          maxRedemptions: trimmedMax ? Number(trimmedMax) : null,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setErr(json.error?.message ?? t.error);
        return;
      }
      setResult(t.success.replace('{code}', json.data.code).replace('{credits}', String(json.data.credits)));
      setCode('');
      setCredits('');
      setMaxRedemptions('');
      // 刷新服务端渲染的码列表,让新码立刻出现。
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
        <label className="flex flex-col gap-1 grow min-w-[14rem]">
          <span className="text-sm text-[var(--muted)]">{t.codeLabel}</span>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t.codePlaceholder}
            autoCapitalize="characters"
            maxLength={64}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm uppercase"
          />
        </label>

        <label className="flex flex-col gap-1 w-28">
          <span className="text-sm text-[var(--muted)]">{t.creditsLabel}</span>
          <input
            type="number"
            step="1"
            min="1"
            value={credits}
            onChange={(e) => setCredits(e.target.value)}
            placeholder="50"
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 w-28">
          <span className="text-sm text-[var(--muted)]">{t.expiryLabel}</span>
          <input
            type="number"
            step="1"
            min="1"
            value={expiryDays}
            onChange={(e) => setExpiryDays(e.target.value)}
            placeholder="30"
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 w-36">
          <span className="text-sm text-[var(--muted)]">{t.maxLabel}</span>
          <input
            type="number"
            step="1"
            min="1"
            value={maxRedemptions}
            onChange={(e) => setMaxRedemptions(e.target.value)}
            placeholder={t.maxPlaceholder}
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
