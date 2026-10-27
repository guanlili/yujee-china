'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { BrandMark } from '@/components/app/Brand';
import { authClient } from '@/lib/auth/client';
import { AUTH_FIELD_CLASS } from '../auth-styles';
import { authHrefWithFrom, safeAuthRedirect } from '@/lib/auth/redirect';
import { stashPendingInvite } from '@/lib/invite/pending-invite';
import type { AppMessages } from '@/lib/i18n/messages';

type AuthMessages = AppMessages['auth'];

// 两种注册通道:
// - 手机号(默认,免验证):POST /api/auth/phone-signup(自定义 better-auth 端点)
//   注册即建会话,直接进应用 —— 邮箱验证墙不存在。
// - 邮箱(存量通道):/sign-up/email 返回 JSON 不跳转,requireEmailVerification
//   下注册当下无会话,成功后显示「去邮箱激活」面板。
export function RegisterForm({
  messages,
  locale,
  from,
}: {
  messages: AuthMessages;
  locale: string;
  from?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'phone' | 'email'>('phone');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const dest = safeAuthRedirect(from, `/${locale}/my-albums`);
  const loginHref = authHrefWithFrom(`/${locale}/login`, from);

  const onPhoneSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/phone-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ phoneNumber: phone, password, name: name.trim() || undefined }),
      });
      if (!res.ok) {
        setError(messages.phoneSignupError);
        setBusy(false);
        return;
      }
      // 手机号注册即有会话;邀请码同轮带上(与邮箱路径的暂存语义对齐)。
      if (inviteCode.trim()) stashPendingInvite(inviteCode);
      router.push(dest);
      router.refresh();
    } catch {
      setError(messages.phoneSignupError);
      setBusy(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signUpError } = await authClient.signUp.email({ name, email, password, callbackURL: dest });
    if (signUpError) {
      setError(messages.registerError);
      setBusy(false);
      return;
    }
    // 注册当下没有会话(邮箱要先验证),暂存邀请码,登录后由 PendingInviteRedeemer 自动兑换。
    if (inviteCode.trim()) stashPendingInvite(inviteCode);
    setSentTo(email);
    setBusy(false);
  };

  if (sentTo) {
    return (
      <div className="text-center">
        <BrandMark size={34} alt="Yujee" className="mx-auto mb-[18px]" />
        <h1
          className="mb-2 text-[32px] font-extrabold tracking-[-0.02em] text-[var(--fg)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {messages.verifyEmailTitle}
        </h1>
        <p className="text-[var(--text-base)] text-[var(--muted)]">
          {messages.verifyEmailLead}
          <br />
          <span className="font-semibold text-[var(--fg)]">{sentTo}</span>
        </p>
        <p className="mt-4 text-[var(--text-base)] text-[var(--fg-2)]">{messages.verifyEmailBody}</p>
        {inviteCode.trim() && (
          <p className="mt-3 text-[var(--text-sm)] font-medium text-[var(--accent-active)]">{messages.inviteCodePending}</p>
        )}
        <p className="mt-3 text-[var(--text-sm)] text-[var(--meta)]">{messages.verifyEmailHint}</p>
        <p className="mt-6 text-[var(--text-sm)]">
          <Link className="font-semibold text-[var(--fg)] hover:underline" href={loginHref}>
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
        <h1
          className="mb-2 text-[32px] font-extrabold tracking-[-0.02em] text-[var(--fg)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {messages.registerTitle}
        </h1>
        <p className="text-[var(--text-base)] text-[var(--muted)]">{messages.registerSubtitle}</p>
      </div>

      {mode === 'phone' ? (
        <form className="flex flex-col gap-[14px]" onSubmit={onPhoneSubmit}>
          <label className="flex flex-col gap-[7px]">
            <span className="text-[var(--text-sm)] font-medium text-[var(--fg-2)]">{messages.name}</span>
            <input
              name="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={AUTH_FIELD_CLASS}
            />
          </label>
          <label className="flex flex-col gap-[7px]">
            <span className="text-[var(--text-sm)] font-medium text-[var(--fg-2)]">{messages.phone}</span>
            <input
              name="phone"
              type="tel"
              required
              inputMode="tel"
              autoComplete="tel"
              placeholder={messages.phonePlaceholder}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={AUTH_FIELD_CLASS}
            />
          </label>
          <label className="flex flex-col gap-[7px]">
            <span className="text-[var(--text-sm)] font-medium text-[var(--fg-2)]">{messages.password}</span>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={AUTH_FIELD_CLASS}
            />
          </label>
          <label className="flex flex-col gap-[7px]">
            <span className="text-[var(--text-sm)] font-medium text-[var(--fg-2)]">{messages.inviteCodeOptional}</span>
            <input
              name="inviteCode"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              placeholder={messages.inviteCodePlaceholder}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className={AUTH_FIELD_CLASS}
            />
          </label>
          {error && <p className="text-[var(--text-sm)] text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-0.5 w-full rounded-[var(--radius-pill)] bg-[var(--fg)] px-5 py-[13px] text-[var(--text-base)] font-semibold text-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-transform duration-[var(--motion-fast)] hover:-translate-y-px disabled:opacity-40"
          >
            {busy ? messages.loading : messages.registerAction}
          </button>
          <button
            type="button"
            onClick={() => { setMode('email'); setError(null); }}
            className="text-[var(--text-sm)] font-medium text-[var(--muted)] hover:text-[var(--fg-2)] hover:underline"
          >
            {messages.useEmailInstead}
          </button>
        </form>
      ) : (
        <form className="flex flex-col gap-[14px]" onSubmit={onSubmit}>
          <label className="flex flex-col gap-[7px]">
            <span className="text-[var(--text-sm)] font-medium text-[var(--fg-2)]">{messages.name}</span>
            <input
              name="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={AUTH_FIELD_CLASS}
            />
          </label>
          <label className="flex flex-col gap-[7px]">
            <span className="text-[var(--text-sm)] font-medium text-[var(--fg-2)]">{messages.email}</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={AUTH_FIELD_CLASS}
            />
          </label>
          <label className="flex flex-col gap-[7px]">
            <span className="text-[var(--text-sm)] font-medium text-[var(--fg-2)]">{messages.password}</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={AUTH_FIELD_CLASS}
            />
          </label>
          <label className="flex flex-col gap-[7px]">
            <span className="text-[var(--text-sm)] font-medium text-[var(--fg-2)]">{messages.inviteCodeOptional}</span>
            <input
              name="inviteCode"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              placeholder={messages.inviteCodePlaceholder}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className={AUTH_FIELD_CLASS}
            />
          </label>
          {error && <p className="text-[var(--text-sm)] text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-0.5 w-full rounded-[var(--radius-pill)] bg-[var(--fg)] px-5 py-[13px] text-[var(--text-base)] font-semibold text-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-transform duration-[var(--motion-fast)] hover:-translate-y-px disabled:opacity-40"
          >
            {busy ? messages.loading : messages.registerAction}
          </button>
          <button
            type="button"
            onClick={() => { setMode('phone'); setError(null); }}
            className="text-[var(--text-sm)] font-medium text-[var(--muted)] hover:text-[var(--fg-2)] hover:underline"
          >
            {messages.usePhoneInstead}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-[var(--text-sm)] text-[var(--muted)]">
        {messages.switchToLogin}{' '}
        <Link className="font-semibold text-[var(--fg)] hover:underline" href={loginHref}>
          {messages.loginAction}
        </Link>
      </p>

      <p className="mt-[22px] text-center text-[var(--text-xs)] leading-[1.6] text-[var(--meta)]">
        {messages.legalPre}{' '}
        <Link className="text-[var(--muted)] underline hover:text-[var(--fg-2)]" href={`/${locale}/terms`}>
          {messages.legalTerms}
        </Link>{' '}
        {messages.legalAnd}{' '}
        <Link className="text-[var(--muted)] underline hover:text-[var(--fg-2)]" href={`/${locale}/privacy`}>
          {messages.legalPrivacy}
        </Link>
      </p>
    </>
  );
}
