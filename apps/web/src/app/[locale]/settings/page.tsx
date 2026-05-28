'use client';

import { use, useEffect, useState } from 'react';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';
import { authClient, signOut } from '@/lib/auth/client';

type Me = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  isAdmin: boolean;
  creditBalance: number;
  createdAt: string;
};

export default function SettingsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = use(params);
  const t = getMessages(locale).dashboard.settings;
  const tc = getMessages(locale).dashboard.common;

  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/v1/user/me');
        const json = await res.json();
        if (json.ok) setMe(json.data);
        else setErr(json.error?.message ?? tc.error);
      } catch {
        setErr(tc.error);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwBusy(true);
    setPwMsg(null);
    setPwErr(null);
    try {
      const { error } = await authClient.changePassword({ currentPassword, newPassword });
      if (error) {
        setPwErr(error.message ?? tc.error);
      } else {
        setPwMsg(t.passwordChanged);
        setCurrentPassword('');
        setNewPassword('');
      }
    } catch {
      setPwErr(tc.error);
    } finally {
      setPwBusy(false);
    }
  };

  const logout = async () => {
    await signOut();
    window.location.href = `/${locale}/login`;
  };

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-6 py-16">
      <h1 className="serif text-4xl mb-10">{t.title}</h1>

      {err && <p className="mb-6 text-sm text-red-600">{err}</p>}

      <section className="rounded-xl border border-[var(--border)] bg-white p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">{t.profile}</h2>
        {me === null ? (
          <p className="text-[var(--muted)]">{tc.loading}</p>
        ) : (
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">{t.email}</dt>
              <dd>{me.email}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">{t.name}</dt>
              <dd>{me.name ?? t.noName}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">{t.memberSince}</dt>
              <dd>{new Date(me.createdAt).toLocaleDateString(locale)}</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-white p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">{t.changePassword}</h2>
        <form onSubmit={changePassword} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium">{t.currentPassword}</span>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="mt-2 w-full rounded-lg border border-[var(--border)] p-3"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">{t.newPassword}</span>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-2 w-full rounded-lg border border-[var(--border)] p-3"
            />
          </label>
          {pwMsg && <p className="text-sm text-emerald-700">{pwMsg}</p>}
          {pwErr && <p className="text-sm text-red-600">{pwErr}</p>}
          <button
            type="submit"
            disabled={pwBusy}
            className="rounded-full bg-[var(--accent)] text-white px-6 py-2.5 text-sm disabled:opacity-40"
          >
            {pwBusy ? t.saving : t.save}
          </button>
        </form>
      </section>

      <button
        type="button"
        onClick={logout}
        className="rounded-full border border-[var(--border)] px-6 py-2.5 text-sm hover:bg-white"
      >
        {t.signOut}
      </button>
    </main>
  );
}
