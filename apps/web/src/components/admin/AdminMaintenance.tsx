'use client';

import { useState } from 'react';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';

type Action = 'recover' | 'cleanup';

export function AdminMaintenance({ locale }: { locale: Locale }) {
  const t = getMessages(locale).admin.settings;

  const [busy, setBusy] = useState<Action | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async (action: Action) => {
    setBusy(action);
    setResult(null);
    setErr(null);
    const path =
      action === 'recover' ? '/api/v1/admin/recover-stuck' : '/api/v1/admin/cleanup-photos';
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!json.ok) {
        setErr(json.error?.message ?? t.error);
        return;
      }
      if (action === 'recover') {
        setResult(
          t.recoverResult
            .replace('{scanned}', String(json.data.scanned))
            .replace('{failed}', String(json.data.failed))
            .replace('{released}', String(json.data.releasedHolds)),
        );
      } else {
        setResult(
          t.cleanupResult
            .replace('{scanned}', String(json.data.scanned))
            .replace('{deleted}', String(json.data.deleted)),
        );
      }
    } catch {
      setErr(t.error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-xl border border-[var(--border)] bg-white p-6">
      <h2 className="text-lg font-semibold mb-4">{t.maintenance}</h2>

      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium">{t.recoverStuck}</p>
            <p className="text-sm text-[var(--muted)]">{t.recoverStuckDesc}</p>
          </div>
          <button
            type="button"
            onClick={() => run('recover')}
            disabled={busy !== null}
            className="shrink-0 rounded-full bg-[var(--accent)] text-white px-5 py-2 text-sm disabled:opacity-40"
          >
            {busy === 'recover' ? t.running : t.run}
          </button>
        </div>

        <div className="flex items-start justify-between gap-4 border-t border-[var(--border)] pt-4">
          <div>
            <p className="font-medium">{t.cleanup}</p>
            <p className="text-sm text-[var(--muted)]">{t.cleanupDesc}</p>
          </div>
          <button
            type="button"
            onClick={() => run('cleanup')}
            disabled={busy !== null}
            className="shrink-0 rounded-full border border-[var(--border)] px-5 py-2 text-sm disabled:opacity-40"
          >
            {busy === 'cleanup' ? t.running : t.run}
          </button>
        </div>
      </div>

      {result && <p className="mt-4 text-sm text-emerald-700">{result}</p>}
      {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
    </section>
  );
}
