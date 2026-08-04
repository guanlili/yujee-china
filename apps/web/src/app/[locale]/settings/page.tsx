'use client';

import { use, useEffect, useState } from 'react';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';
import { useAnonymousRedirect } from '@/components/app/useAnonymousRedirect';
import { authClient, signOut } from '@/lib/auth/client';
import { AppChrome } from '@/components/app/AppChrome';

const DELETION_EMAIL = 'privacy@yujeeai.com';

const card =
  'rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-card)] p-6 mb-8';
const heading = 'text-[var(--text-lg)] font-semibold mb-4';
const field =
  'mt-2 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text-base)] outline-none transition focus:border-[var(--accent)]';
const primaryBtn =
  'rounded-[var(--radius-pill)] bg-[var(--accent)] px-6 py-2.5 text-[var(--text-sm)] text-white transition hover:opacity-90 disabled:opacity-40';
const secondaryBtn =
  'rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface)] px-6 py-2.5 text-[var(--text-sm)] transition hover:bg-[var(--bg)]';

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
  // 游客(匿名影子账号)不进账号页:带回跳丢去登录(middleware 只看 cookie 存在性,拦不住)。
  useAnonymousRedirect(locale, `/${locale}/settings`);
  const t = getMessages(locale).dashboard.settings;
  const tc = getMessages(locale).dashboard.common;

  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);

  const [inviteCode, setInviteCode] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [inviteErr, setInviteErr] = useState<string | null>(null);

  // 兑换失败:后端返回具体错误码 → 本地化提示;未知码回落通用提示。
  const inviteErrorText = (code: string | undefined): string => {
    switch (code) {
      case 'INVITE_CODE_INVALID': return t.inviteErrInvalid;
      case 'INVITE_CODE_EXPIRED': return t.inviteErrExpired;
      case 'INVITE_CODE_USED': return t.inviteErrUsed;
      case 'INVITE_CODE_EXHAUSTED': return t.inviteErrExhausted;
      default: return t.inviteErrGeneric;
    }
  };

  const redeemInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = inviteCode.trim();
    if (!code || inviteBusy) return;
    setInviteBusy(true);
    setInviteMsg(null);
    setInviteErr(null);
    try {
      const res = await fetch('/api/v1/invite/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();
      if (json.ok) {
        setInviteMsg(
          t.inviteSuccess
            .replace('{credits}', String(json.data.credits))
            .replace('{balance}', String(json.data.balance)),
        );
        setInviteCode('');
        setMe((prev) => (prev ? { ...prev, creditBalance: json.data.balance } : prev));
      } else {
        setInviteErr(inviteErrorText(json.error?.code));
      }
    } catch {
      setInviteErr(t.inviteErrGeneric);
    } finally {
      setInviteBusy(false);
    }
  };

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

  const deletionMailto =
    `mailto:${DELETION_EMAIL}?subject=${encodeURIComponent(t.deleteAccountSubject)}` +
    (me ? `&body=${encodeURIComponent(`${t.email}: ${me.email}`)}` : '');

  return (
    <AppChrome locale={locale} activeNav="home">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <h1 className="serif text-4xl mb-10">{t.title}</h1>

        {err && <p className="mb-6 text-[var(--text-sm)] text-red-600">{err}</p>}

        <section className={card}>
          <h2 className={heading}>{t.profile}</h2>
          {me === null ? (
            <p className="text-[var(--muted)]">{tc.loading}</p>
          ) : (
            <dl className="space-y-3 text-[var(--text-sm)]">
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

        <section className={card}>
          <h2 className={heading}>{t.inviteTitle}</h2>
          <p className="text-[var(--text-sm)] text-[var(--muted)] mb-4">{t.inviteDesc}</p>
          <form onSubmit={redeemInvite} className="flex flex-wrap items-start gap-3">
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder={t.invitePlaceholder}
              autoCapitalize="characters"
              spellCheck={false}
              className={`${field} mt-0 flex-1 min-w-[200px] uppercase tracking-wide`}
            />
            <button type="submit" disabled={inviteBusy || !inviteCode.trim()} className={primaryBtn}>
              {inviteBusy ? t.inviteRedeeming : t.inviteRedeem}
            </button>
          </form>
          {inviteMsg && <p className="mt-3 text-[var(--text-sm)] text-emerald-700">{inviteMsg}</p>}
          {inviteErr && <p className="mt-3 text-[var(--text-sm)] text-red-600">{inviteErr}</p>}
        </section>

        <section className={card}>
          <h2 className={heading}>{t.changePassword}</h2>
          <form onSubmit={changePassword} className="space-y-4">
            <label className="block">
              <span className="text-[var(--text-sm)] font-medium">{t.currentPassword}</span>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={field}
              />
            </label>
            <label className="block">
              <span className="text-[var(--text-sm)] font-medium">{t.newPassword}</span>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={field}
              />
            </label>
            {pwMsg && <p className="text-[var(--text-sm)] text-emerald-700">{pwMsg}</p>}
            {pwErr && <p className="text-[var(--text-sm)] text-red-600">{pwErr}</p>}
            <button type="submit" disabled={pwBusy} className={primaryBtn}>
              {pwBusy ? t.saving : t.save}
            </button>
          </form>
        </section>

        <section className={card}>
          <h2 className={heading}>{t.account}</h2>
          <button type="button" onClick={logout} className={secondaryBtn}>
            {t.signOut}
          </button>

          <hr className="my-6 border-[var(--border-soft)]" />

          <h3 className="text-[var(--text-base)] font-medium mb-2">{t.deleteAccount}</h3>
          <p className="text-[var(--text-sm)] text-[var(--muted)] leading-relaxed mb-4">
            {t.deleteAccountBody}
          </p>
          <a
            href={deletionMailto}
            className="inline-flex rounded-[var(--radius-pill)] border border-red-300 px-6 py-2.5 text-[var(--text-sm)] text-red-600 transition hover:bg-red-50"
          >
            {t.deleteAccountCta}
          </a>
        </section>
      </div>
    </AppChrome>
  );
}
