'use client';

/* ════════════════════════════════════════════════════════════════════════════
   CreditsPurchaseModal — in-editor "buy credits" dialog.

   Replaces the old "out of credits → navigate to /credits" jump. The editor tab
   NEVER navigates: checkout opens in a NEW tab, and this modal polls the balance
   endpoint until the webhook credits the account, then hands control back to the
   chat rail (re-enable send, hide the #balanceAlert banner) via onToppedUp().

   Rendered via createPortal to document.body so it reliably covers the viewport
   regardless of any transformed ancestor in the editor tree (the chat rail is a
   position:fixed floater). Visual spec lives in editor-port.css (.credits-modal-*)
   and mirrors the confirmed design (radio-card packs, serif $ price band, one
   "most popular" badge on the 10-credit pack, pure-black CTA, dark-mode aware).

   Source of truth for pack contents is ADDON_PACKS; "≈ N photos" is derived from
   PHOTOS_PER_CREDIT — never hardcode the photo counts or the dollar amounts here.
   ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ADDON_PACKS, PHOTOS_PER_CREDIT } from '@/config/pricing';
import type { Locale } from '@/lib/i18n/routing';

// Poll cadence + hard cap for the "waiting for payment" balance watcher.
const BALANCE_POLL_MS = 3000;
const POLL_CAP_MS = 5 * 60 * 1000; // stop auto-polling after 5 minutes; manual refresh stays.
// Default-selected pack + the single pack that wears the "most popular" badge.
const DEFAULT_PACK_ID = 'pack-10';
const POPULAR_PACK_ID = 'pack-10';

type Phase = 'select' | 'waiting';

export function CreditsPurchaseModal({
  open,
  locale,
  onClose,
  onToppedUp,
}: {
  open: boolean;
  locale: Locale;
  onClose: () => void;
  onToppedUp: () => void;
}) {
  const zh = locale === 'zh';
  const [mounted, setMounted] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_PACK_ID);
  const [phase, setPhase] = useState<Phase>('select');
  const [error, setError] = useState<string | null>(null);
  const [manualPayUrl, setManualPayUrl] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);

  // Baseline balance captured when the modal opens; a top-up is balance STRICTLY
  // above this (the webhook settles the purchase). Ref, not state — polling reads it.
  const baselineRef = useRef<number | null>(null);
  // Keep the latest onToppedUp without re-subscribing the poll effect every parent render.
  const onToppedUpRef = useRef(onToppedUp);
  onToppedUpRef.current = onToppedUp;

  // Portal host is only available in the browser; gate createPortal behind mount so SSR
  // (the editor is server-rendered for initial HTML) never touches document.body.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch balance once; returns the numeric balance or null.
  const fetchBalance = useCallback(async (): Promise<number | null> => {
    try {
      const j = (await (await fetch('/api/v1/credit/balance')).json()) as {
        ok?: boolean;
        data?: { balance?: number };
      };
      return j?.ok && typeof j.data?.balance === 'number' ? j.data.balance : null;
    } catch {
      return null;
    }
  }, []);

  // On open: reset to the select phase, snapshot the baseline balance. On close: nothing
  // to tear down here (the poll effect below owns the interval cleanup).
  useEffect(() => {
    if (!open) return;
    setPhase('select');
    setError(null);
    setManualPayUrl(null);
    setSelectedId(DEFAULT_PACK_ID);
    baselineRef.current = null;
    let cancelled = false;
    void fetchBalance().then((bal) => {
      if (!cancelled && bal !== null) baselineRef.current = bal;
    });
    return () => {
      cancelled = true;
    };
  }, [open, fetchBalance]);

  // Escape closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Poll the balance while waiting for payment. Stops on: top-up detected, modal close,
  // phase change, unmount, or the 5-minute cap. No dangling interval ever survives.
  useEffect(() => {
    if (!open || phase !== 'waiting') return;
    const deadline = Date.now() + POLL_CAP_MS;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (stopped) return;
      const bal = await fetchBalance();
      const base = baselineRef.current;
      if (!stopped && bal !== null && base !== null && bal > base) {
        stopped = true;
        onToppedUpRef.current();
        return;
      }
      if (stopped || Date.now() >= deadline) return; // hit cap → stop auto-poll; manual button remains
      timer = setTimeout(tick, BALANCE_POLL_MS);
    };
    timer = setTimeout(tick, BALANCE_POLL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, phase, fetchBalance]);

  const startCheckout = useCallback(async () => {
    if (checkingOut) return;
    setCheckingOut(true);
    setError(null);
    setManualPayUrl(null);
    try {
      const res = await fetch('/api/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId: selectedId, locale, from: 'album' }),
      });
      const json = (await res.json()) as { ok?: boolean; data?: { url?: string }; error?: { message?: string } };
      if (json?.ok && json.data?.url) {
        const url = json.data.url;
        // Payment opens in a NEW tab — the editor tab must never navigate away. If the
        // popup is blocked (window.open → null), fall back to a manual link (still no nav).
        const win = window.open(url, '_blank');
        if (!win) setManualPayUrl(url);
        setPhase('waiting');
        return;
      }
      setError(json?.error?.message ?? (zh ? '发起支付失败，请重试。' : 'Couldn’t start checkout — please try again.'));
    } catch {
      setError(zh ? '发起支付失败，请重试。' : 'Couldn’t start checkout — please try again.');
    } finally {
      setCheckingOut(false);
    }
  }, [checkingOut, selectedId, locale, zh]);

  // "I've paid — refresh": one immediate balance check; hands off if credited, else nudges.
  const manualRefresh = useCallback(async () => {
    const bal = await fetchBalance();
    const base = baselineRef.current;
    if (bal !== null && base !== null && bal > base) {
      onToppedUpRef.current();
      return;
    }
    setError(zh ? '还没检测到积分到账，稍等片刻再刷新～' : 'No credits detected yet — give it a moment and refresh.');
  }, [fetchBalance, zh]);

  if (!mounted) return null;

  const selected = ADDON_PACKS.find((p) => p.id === selectedId) ?? ADDON_PACKS[ADDON_PACKS.length - 1]!;
  const titleId = 'creditsModalTitle';

  const overlay = (
    <div
      className={`credits-modal-overlay${open ? ' open' : ''}`}
      data-credits-modal
      aria-hidden={!open}
      onMouseDown={(e) => {
        // Backdrop click closes (mirrors the editor's data-overlay-close convention).
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="credits-modal-card" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="credits-modal-inner">
          <button
            type="button"
            className="credits-modal-close"
            onClick={onClose}
            aria-label={zh ? '关闭' : 'Close'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>

          <h2 className="credits-modal-title" id={titleId}>
            {zh ? '购买积分' : 'Buy credits'}
          </h2>

          {phase === 'select' && (
            <>
              <p className="credits-modal-sub">
                {zh
                  ? `积分用于 AI 排版与文案生成，1 积分可处理约 ${PHOTOS_PER_CREDIT} 张照片。买得越多越划算，永久有效。`
                  : `Credits power AI layout and writing — 1 credit handles about ${PHOTOS_PER_CREDIT} photos. Buy more to save; they never expire.`}
              </p>

              <div className="credits-pack-list" role="radiogroup" aria-label={zh ? '选择积分包' : 'Choose a credit pack'}>
                {ADDON_PACKS.map((pack) => {
                  const isSel = pack.id === selectedId;
                  const photos = pack.books * PHOTOS_PER_CREDIT; // derived — never hardcode
                  const popular = pack.id === POPULAR_PACK_ID;
                  return (
                    <button
                      key={pack.id}
                      type="button"
                      role="radio"
                      aria-checked={isSel}
                      className={`credits-pack${isSel ? ' sel' : ''}`}
                      onClick={() => setSelectedId(pack.id)}
                    >
                      {popular && (
                        <span className="credits-pack-badge">{zh ? '最受欢迎' : 'Most popular'}</span>
                      )}
                      <span className="credits-pack-radio" aria-hidden="true" />
                      <span className="credits-pack-info">
                        <span className="credits-pack-cred">
                          {zh ? `${pack.books} 积分` : `${pack.books} credit${pack.books > 1 ? 's' : ''}`}
                        </span>
                        <span className="credits-pack-cap">
                          {zh ? `可处理约 ${photos} 张照片` : `About ${photos} photos`}
                        </span>
                      </span>
                      <span className="credits-pack-price">
                        <span className="credits-pack-cur">$</span>
                        {pack.priceUsd}
                      </span>
                    </button>
                  );
                })}
              </div>

              {error && <p className="credits-modal-error">{error}</p>}

              <button type="button" className="credits-modal-cta" onClick={startCheckout} disabled={checkingOut}>
                <span>
                  {checkingOut ? (zh ? '正在跳转…' : 'Starting…') : zh ? '立即购买' : 'Buy now'}
                </span>
                <span className="credits-modal-cta-amt">${selected.priceUsd}</span>
              </button>

              <div className="credits-modal-foot">
                {zh ? '安全支付，买完自动回到这里继续' : 'Secure checkout — you’ll return here automatically.'}
                <span className="credits-modal-foot-sep">·</span>
                {zh ? '购买即同意' : 'By buying you agree to the '}
                <a href={`/${locale}/terms`} target="_blank" rel="noreferrer">
                  {zh ? '《服务条款》' : 'Terms'}
                </a>
              </div>
            </>
          )}

          {phase === 'waiting' && (
            <div className="credits-modal-waiting">
              <span className="credits-modal-spinner" aria-hidden="true" />
              <p className="credits-modal-waiting-text">
                {zh
                  ? '已在新标签页打开支付，完成后会自动返回这里继续。'
                  : 'Payment opened in a new tab — you’ll return here automatically once it’s done.'}
              </p>
              {manualPayUrl && (
                <a className="credits-modal-paylink" href={manualPayUrl} target="_blank" rel="noreferrer">
                  {zh ? '弹窗被拦截了？点此打开支付页' : 'Popup blocked? Open the payment page'}
                </a>
              )}
              {error && <p className="credits-modal-error">{error}</p>}
              <button type="button" className="credits-modal-refresh" onClick={manualRefresh}>
                {zh ? '我已付款，刷新' : 'I’ve paid — refresh'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
