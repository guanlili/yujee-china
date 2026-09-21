'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { UserMenu } from '@/components/app/UserMenu';
import { useChromeSession } from '@/components/app/useChromeSession';
import { LANDING_COPIES, type Sample } from '@/components/landing/copy';
import { ADDON_PACKS, PAGES_PER_CREDIT_LABEL, PHOTOS_PER_CREDIT } from '@/config/pricing';
import { SOCIAL_LINKS, SUPPORT_EMAIL } from '@/config/social';
import { useSession } from '@/lib/auth/client';
import { getMessages } from '@/lib/i18n/messages';
import { pick } from '@/lib/i18n/pick';
import { LOCALE_LABELS, localizePath, locales, type Locale } from '@/lib/i18n/routing';

// Pricing copy states the rule through {photos}/{pages} tokens so the numbers can
// only ever come from the constants. Rendering the raw message would ship the
// literal "{photos}" to users — which is exactly what happened once.
const withPhotoRule = (copy: string) =>
  copy
    .replaceAll('{photos}', String(PHOTOS_PER_CREDIT))
    .replaceAll('{pages}', PAGES_PER_CREDIT_LABEL);

export type HeroSample = {
  slug: string;
  href: string;
  poster: string;
  title: string;
};

type Props = {
  locale: Locale;
  composer: ReactNode;
  /** One entry per /examples page, in hub order. Rendered as the strip under the composer. */
  heroSamples: HeroSample[];
};

function Icon({ name }: { name: 'home' | 'folder' | 'layout' | 'spark' | 'book' | 'menu' | 'x' }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-[18px] w-[18px]" {...common}>
      {name === 'home' && (
        <>
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </>
      )}
      {name === 'folder' && <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />}
      {name === 'layout' && (
        <>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </>
      )}
      {name === 'spark' && (
        <>
          <path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
      {name === 'book' && (
        <>
          <path d="M12 6.5C10.5 5 7.5 4.5 4 5v13c3.5-.5 6.5 0 8 1.5 1.5-1.5 4.5-2 8-1.5V5c-3.5-.5-6.5 0-8 1.5Z" />
          <path d="M12 6.5V19.5" />
        </>
      )}
      {name === 'menu' && <path d="M3 6h18M3 12h18M3 18h18" />}
      {name === 'x' && <path d="M6 6l12 12M18 6 6 18" />}
    </svg>
  );
}

function ArrowIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function FAQItem({
  q,
  a,
  open,
  onToggle,
}: {
  q: string;
  a: ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`faq-item${open ? ' open' : ''}`}>
      <button type="button" className="faq-q" aria-expanded={open} onClick={onToggle}>
        <span>{q}</span>
        <svg aria-hidden className="faq-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <div className="faq-a" style={{ maxHeight: open ? 240 : 0 }}>
        <div className="faq-a-inner">{a}</div>
      </div>
    </div>
  );
}

function SampleCard({
  sample,
  sampleCta,
  makeSame,
  composerHref,
  exampleHref,
}: {
  sample: Sample;
  sampleCta: string;
  makeSame: string;
  composerHref: string;
  /** The /examples/<slug> page for this format — where the card sends a reader who wants proof. */
  exampleHref: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const play = () => {
    videoRef.current?.play().catch(() => {});
  };
  const stop = () => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = 0;
  };

  return (
    <article
      className="sample-card"
      tabIndex={0}
      onMouseEnter={play}
      onMouseLeave={stop}
      onFocus={play}
      onBlur={(event) => {
        // 焦点仍在卡片内部(如详情里的链接)时不打断播放
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) stop();
      }}
    >
      <div
        className="sample-bg"
        style={{
          background: `url(${sample.image}) no-repeat right bottom / 75%, linear-gradient(90deg, transparent, #fff) left center/16% 100% no-repeat, linear-gradient(90deg, #fff, transparent) right center/16% 100% no-repeat, linear-gradient(180deg, rgba(61,160,149,.09), rgba(148,120,210,.09), rgba(205,221,131,.09)) left center/16% 100% no-repeat, linear-gradient(180deg, rgba(61,160,149,.09), rgba(148,120,210,.09), rgba(205,221,131,.09)) right center/16% 100% no-repeat, #fff`,
        }}
      />
      <div className="sample-front">
        <div>
          <div className="case-title">{sample.title}</div>
          <p className="sample-brief">{sample.brief}</p>
        </div>
        <Link href={exampleHref} className="case-cta">
          {sampleCta}
          <ArrowIcon className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="sample-detail">
        <video
          ref={videoRef}
          className="sample-shot"
          src={sample.video}
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden
        />
        <div className="case-title">{sample.title}</div>
        <p>{sample.body}</p>
        <ul className="flex flex-col gap-1.5">
          {sample.bullets.map((bullet) => (
            <li key={bullet} className="flex gap-2">
              <span className="text-[var(--accent)]">·</span>
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
        {/* Proof first, ask second: the primary action opens the finished sample,
            the composer stays one line below. Every card used to send readers to
            the upload box — the one place a skeptic had not yet decided to go. */}
        <Link href={exampleHref} className="sample-btn">
          {sampleCta}
          <ArrowIcon className="h-[15px] w-[15px]" />
        </Link>
        <Link href={composerHref} className="sample-btn-alt">
          {makeSame}
        </Link>
      </div>
    </article>
  );
}

function LandingPricing({ locale }: { locale: Locale }) {
  const t = getMessages(locale).pricing;
  const tc = getMessages(locale).dashboard.common;
  // Copy comes from messages/*.json for BOTH locales. The zh strings used to be
  // hardcoded here, which quietly shadowed zh.json — so a copy edit in the JSON
  // did nothing on the Chinese home. Don't reintroduce a per-locale literal.
  const priceTitle = t.title;
  const priceSubtitle = withPhotoRule(t.subtitle);
  const bestValue = t.bestValue;
  const { data: session, isPending } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const baselinePerBook = ADDON_PACKS[0].priceUsd / ADDON_PACKS[0].books;
  const bestPackId = ADDON_PACKS.reduce((a, b) => (b.books > a.books ? b : a)).id;

  const buy = async (packId: string) => {
    if (isPending) return;
    if (!session) {
      window.location.href = `/${locale}/login?from=${encodeURIComponent(`/${locale}#pricing`)}`;
      return;
    }
    setBusy(packId);
    setErr(null);
    try {
      const res = await fetch('/api/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId, locale, from: 'home' }),
      });
      const json = await res.json();
      if (json.ok && json.data?.url) {
        window.location.href = json.data.url;
        return;
      }
      setErr(json.error?.message ?? tc.error);
    } catch {
      setErr(tc.error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id="pricing" className="py-16 md:py-20">
      <div className="wrap">
        <div className="mx-auto mb-9 max-w-xl text-center md:mb-11">
          <div className="sec-label">{pick(locale, { zh: '价格', en: 'Pricing' })}</div>
          <h2 className="sec-title mt-3">{priceTitle}</h2>
          <p className="mt-3 text-sm text-[var(--muted)]">{priceSubtitle}</p>
        </div>
        {err && <p className="mb-5 text-center text-sm text-red-600">{err}</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
          {ADDON_PACKS.map((pack) => {
            const perBook = pack.priceUsd / pack.books;
            const savePct = Math.round((1 - perBook / baselinePerBook) * 100);
            const isBest = pack.id === bestPackId;
            const isBusy = busy === pack.id;
            const disabled = busy !== null || isPending;

            return (
              <div key={pack.id} className="flex flex-col rounded-2xl bg-white p-5 shadow-[var(--shadow-card)] md:p-6">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--fg-2)]">
                    {pack.books.toLocaleString(locale)} {pack.books > 1 ? t.unit : t.unitSingular}
                  </span>
                  {isBest && (
                    <span className="best-value-badge">
                      {bestValue}
                    </span>
                  )}
                </div>
                <div className="price-figure mt-3 text-4xl font-extrabold tracking-tight md:text-5xl" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  ${pack.priceUsd}
                </div>
                <div className="mt-2 text-xs text-[var(--muted)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  ${perBook.toFixed(2)} {t.perBook}
                  {savePct > 0 && (
                    <span className="ml-1 font-semibold text-[var(--accent)]">-{savePct}%</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => buy(pack.id)}
                  disabled={disabled}
                  className={`mt-6 inline-flex items-center justify-center rounded-full py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    isBest
                      ? 'bg-[var(--fg)] text-white hover:bg-black'
                      : 'border border-black/15 text-[var(--fg)] hover:bg-black/5'
                  }`}
                >
                  {isBusy ? t.redirecting : t.buy}
                </button>
              </div>
            );
          })}
        </div>
        {!isPending && !session && (
          <p className="mt-8 text-center text-xs text-[var(--meta)]">{t.loginHint}</p>
        )}
      </div>
    </section>
  );
}

export function YujeeLandingHomeClient({ locale, composer, heroSamples }: Props) {
  const c = LANDING_COPIES[locale];
  const dashboard = getMessages(locale).dashboard;
  const chrome = dashboard.chrome;
  const chromeSession = useChromeSession();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [navScrolled, setNavScrolled] = useState(false);
  const [activePreview, setActivePreview] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const preview = c.previewChapters[activePreview];

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActivePreview((current) => (current + 1) % c.previewChapters.length);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [c.previewChapters.length]);

  const home = `/${locale}`;
  const composerHref = `${home}#homepage-composer`;
  const currentLanguageLabel = LOCALE_LABELS[locale];
  const accountLinks: Array<[string, string]> = chromeSession.user
    ? [
        [dashboard.nav.myAlbums, `/${locale}/my-albums`],
        [chrome.manageSubscription, `/${locale}/credits`],
        [chrome.creditHistory, `/${locale}/credits#history`],
      ]
    : [
        [c.login, `/${locale}/login`],
        [c.signup, composerHref],
      ];

  return (
    <div className={`landing-redesign min-h-screen text-[var(--fg)] locale-${locale}`}>
      <style>{`
        .landing-redesign {
          background: #f5f5f5;
          overflow-x: clip;
          --landing-art-font: 'Playfair Display', Georgia, serif;
          --landing-cjk-art-font: 'Playfair Display', 'Noto Serif SC Landing', 'Songti SC', 'Noto Serif SC', Georgia, serif;
          --landing-display-font: var(--landing-cjk-art-font);
        }
        html { scroll-behavior: smooth; }
        .landing-redesign .wrap { max-width: 1320px; margin: 0 auto; padding: 0 20px; }
        @media (min-width: 768px) { .landing-redesign .wrap { padding: 0 32px; } }
        /* ── 导航:悬浮液态玻璃胶囊。**顶部即为玻璃**(不再是滚动后才显形),
           滚动后收窄并加深磨砂。玻璃质感由四件叠出来,少任何一件都会塌成普通半透明色块:
           ① backdrop-filter 的 saturate/brightness —— 只 blur 会发灰,提饱和+提亮才像玻璃透光;
           ② 四条内缘 inset 高光 —— 玻璃的「厚度」全靠边缘吃光,上缘最亮、下缘次之、左右留微光;
           ③ ::before 的 mask-composite 镶边 —— 挖空中心只留 1.6px 描边,形成全周高光圈;
           ④ ::after 的上缘反光薄条 —— 70% 处淡出,不压正文对比度。
           ::before/::after 都不裁剪(不加 overflow:hidden),否则会切掉语言下拉与移动抽屉。 ── */
        .nav-wrap { position: fixed; top: 0; left: 0; right: 0; z-index: 50; display: flex; justify-content: center; padding: 0; transition: padding .4s cubic-bezier(.4,0,.2,1); }
        .nav-wrap.scrolled { padding: 9px 16px; }
        .nav-pill {
          position: relative;
          width: 100%; max-width: none;
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
          padding: 14px 28px; border-radius: 0;
          background: transparent; border: 0;
          box-shadow: none;
          transition: max-width .45s cubic-bezier(.4,0,.2,1), padding .4s ease,
                      background .35s ease, box-shadow .4s ease, border-radius .4s ease,
                      -webkit-backdrop-filter .35s ease, backdrop-filter .35s ease;
        }
        .nav-pill::before {
          content: ''; opacity: 0; transition: opacity .35s ease; position: absolute; inset: 0; border-radius: inherit; padding: 1.6px;
          background: linear-gradient(180deg,
            rgba(255,255,255,1) 0%,
            rgba(255,255,255,.45) 20%,
            rgba(255,255,255,.06) 40%,
            rgba(255,255,255,.06) 60%,
            rgba(255,255,255,.4) 80%,
            rgba(255,255,255,.95) 100%);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor; mask-composite: exclude;
          pointer-events: none;
        }
        .nav-pill::after {
          content: ''; opacity: 0; transition: opacity .35s ease; position: absolute; left: 1.6px; right: 1.6px; top: 1.6px; height: 44%;
          border-radius: 9999px 9999px 40px 40px;
          background: linear-gradient(180deg, rgba(255,255,255,.32), rgba(255,255,255,0) 70%);
          pointer-events: none;
        }
        .nav-wrap.scrolled .nav-pill::before,
        .nav-wrap.scrolled .nav-pill::after { opacity: 1; }
        .nav-wrap.scrolled .nav-pill {
          max-width: 1120px; padding: 8px 12px 8px 18px; border-radius: 9999px;
          background: rgba(255,255,255,.52);
          -webkit-backdrop-filter: blur(10px) saturate(215%) brightness(1.08);
          backdrop-filter: blur(10px) saturate(215%) brightness(1.08) url(#navGlass);
          box-shadow:
            0 10px 34px rgba(0,0,0,.12),
            0 1px 2px rgba(0,0,0,.06),
            0 0 0 .5px rgba(0,0,0,.05),
            inset 0 1.5px 1.5px rgba(255,255,255,1),
            inset 0 -1.5px 2px rgba(255,255,255,.6),
            inset 1.5px 0 2px rgba(255,255,255,.45),
            inset -1.5px 0 2px rgba(255,255,255,.45);
        }
        /* 左侧悬浮菜单胶囊:与导航同款液态玻璃(四缘内高光 + 全周镶边 + 同一枚真折射滤镜)。
           同样不加 overflow:hidden —— 否则会裁掉 hover 时从右侧探出的图标提示气泡。 */
        .glass-dock {
          background: rgba(255,255,255,.42);
          -webkit-backdrop-filter: blur(8px) saturate(205%) brightness(1.06);
          backdrop-filter: blur(8px) saturate(205%) brightness(1.06) url(#navGlass);
          box-shadow:
            0 8px 30px rgba(0,0,0,.09),
            0 1px 2px rgba(0,0,0,.05),
            0 0 0 .5px rgba(0,0,0,.045),
            inset 0 1.5px 1.5px rgba(255,255,255,.95),
            inset 0 -1.5px 2px rgba(255,255,255,.55),
            inset 1.5px 0 2px rgba(255,255,255,.4),
            inset -1.5px 0 2px rgba(255,255,255,.4);
        }
        .glass-dock::before {
          content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1.6px;
          background: linear-gradient(180deg,
            rgba(255,255,255,1) 0%, rgba(255,255,255,.45) 20%,
            rgba(255,255,255,.06) 40%, rgba(255,255,255,.06) 60%,
            rgba(255,255,255,.4) 80%, rgba(255,255,255,.95) 100%);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor; mask-composite: exclude;
          pointer-events: none;
        }
        /* 不支持 backdrop-filter 的浏览器:回落成近乎不透明的白,保证文字可读 ——
           半透明 + 不模糊会让背后内容直接透出来糊在导航文字上。 */
        @supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
          /* 静止平铺态本就没有底色,不需要回落;只有胶囊态要保证文字压在半透明底上可读。 */
          .nav-wrap.scrolled .nav-pill { background: rgba(255,255,255,.96); }
          .glass-dock { background: rgba(255,255,255,.92); }
        }
        .nav-link { display: inline-flex; align-items: center; gap: 4px; color: #333; font-size: 14px; font-weight: 500; padding: 8px 12px; border-radius: 9999px; transition: background .18s ease, color .18s ease; white-space: nowrap; background: none; border: 0; cursor: pointer; }
        .nav-link:hover { background: rgba(0,0,0,.05); color: #111; }
        .chev { transition: transform .2s ease; }
        .has-menu { position: relative; }
        .has-menu::after { content: ''; position: absolute; top: 100%; left: 0; right: 0; height: 16px; }
        .nav-pop { position: absolute; top: calc(100% + 14px); left: 50%; transform: translateX(-50%) translateY(-6px); min-width: 212px; border-radius: 16px; background: #fff; padding: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.05), 0 14px 36px rgba(0,0,0,.13); opacity: 0; visibility: hidden; pointer-events: none; transition: opacity .2s ease, transform .2s ease; }
        .has-menu:hover .nav-pop { opacity: 1; visibility: visible; pointer-events: auto; transform: translateX(-50%) translateY(0); }
        .has-menu:hover .chev { transform: rotate(180deg); }
        .nav-pop a { display: block; border-radius: 10px; padding: 10px 12px; color: #111; font-size: 14px; font-weight: 500; transition: background .15s ease; }
        .nav-pop a:hover, .nav-pop a.is-active { background: #f5f5f5; }
        .nav-pop-lang { left: auto; right: 0; min-width: 150px; transform: translateY(-6px); }
        .has-menu:hover .nav-pop-lang { transform: translateY(0); }
        .m-sheet { position: absolute; top: calc(100% + 8px); left: 16px; right: 16px; background: #fff; border-radius: 18px; box-shadow: 0 2px 8px rgba(0,0,0,.06), 0 18px 44px rgba(0,0,0,.16); padding: 10px; opacity: 0; visibility: hidden; transform: translateY(-8px); transition: all .22s ease; }
        .m-sheet.open { opacity: 1; visibility: visible; transform: translateY(0); }
        .m-sheet > a { display: block; padding: 12px 14px; border-radius: 12px; font-size: 15px; font-weight: 500; color: #333; }
        .m-sheet > a:hover { background: #f5f5f5; color: #111; }
        .m-lang { display: flex; gap: 8px; margin-top: 6px; border-top: 1px solid #ebebeb; padding: 10px 6px 4px; }
        .m-lang a { flex: 1; border-radius: 10px; padding: 9px 0; background: #f5f5f5; color: #888; text-align: center; font-size: 13px; font-weight: 600; }
        .m-lang a.is-active { background: #111; color: #fff; }
        .btn-glow { position: relative; display: inline-block; }
        .btn-glow > a { position: relative; z-index: 1; transition: transform .2s ease; }
        .btn-glow::after { content: ''; position: absolute; z-index: 0; pointer-events: none; left: 6%; right: 6%; bottom: -3px; height: 72%; background: linear-gradient(90deg,#13B8A6,#8C5EF4,#DAF45E); filter: blur(14px); opacity: .7; border-radius: 9999px; transition: filter .3s ease, opacity .3s ease, bottom .3s ease; }
        .btn-glow:hover > a { transform: translateY(-2px); }
        .btn-glow:hover::after { filter: blur(18px); opacity: .85; bottom: -5px; }
        .create-glow { position: absolute; left: -8%; right: -8%; top: -6%; bottom: -22%; z-index: 0; pointer-events: none; background: radial-gradient(closest-side, rgba(19,184,166,.44), transparent) 8% 70% / 52% 58% no-repeat, radial-gradient(closest-side, rgba(140,94,244,.42), transparent) 30% 24% / 54% 58% no-repeat, radial-gradient(closest-side, rgba(218,244,94,.48), transparent) 60% 86% / 56% 60% no-repeat, radial-gradient(closest-side, rgba(19,184,166,.40), transparent) 92% 44% / 52% 60% no-repeat, radial-gradient(closest-side, rgba(140,94,244,.34), transparent) 80% 92% / 48% 56% no-repeat, radial-gradient(closest-side, rgba(218,244,94,.30), transparent) 14% 30% / 44% 50% no-repeat; filter: blur(18px); }
        .composer-shell #homepage-composer { max-width: 720px; margin: 0 auto; }
        .sample-grid { display: grid; grid-template-columns: repeat(1, 1fr); }
        @media (min-width: 640px) { .sample-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (min-width: 1000px) { .sample-grid { grid-template-columns: repeat(3, 1fr); } }
        .sample-card { position: relative; z-index: 0; border-radius: 18px; overflow: hidden; aspect-ratio: 3 / 2; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.04), 0 8px 28px rgba(0,0,0,.08); transition: box-shadow .3s ease; }
        .sample-card:hover, .sample-card:focus-within { overflow: visible; z-index: 5; }
        .sample-bg { position: absolute; inset: 0; }
        .sample-front { position: absolute; inset: 0; padding: 20px; display: flex; flex-direction: column; justify-content: space-between; transition: opacity .18s ease; }
        .sample-card:hover .sample-front, .sample-card:focus-within .sample-front { opacity: 0; }
        .sample-detail { position: absolute; top: 0; left: 0; right: 0; height: 100%; padding: 16px; display: flex; flex-direction: column; gap: 9px; overflow: hidden; border-radius: 18px; background: #fff; box-shadow: 0 0 0 rgba(0,0,0,0); opacity: 0; pointer-events: none; transition: opacity .22s ease, left .46s cubic-bezier(.22,.8,.24,1), right .46s cubic-bezier(.22,.8,.24,1), height .46s cubic-bezier(.22,.8,.24,1), box-shadow .46s ease; }
        .sample-card:hover .sample-detail, .sample-card:focus-within .sample-detail { opacity: 1; left: -5%; right: -5%; height: 200%; pointer-events: auto; box-shadow: 0 4px 14px rgba(0,0,0,.08), 0 26px 60px rgba(0,0,0,.22); }
        .sample-shot { display: block; width: 100%; flex: 0 0 46%; min-height: 0; border-radius: 12px; object-fit: cover; background: linear-gradient(125deg, rgba(140,94,244,.55), rgba(19,184,166,.40) 50%, rgba(218,244,94,.45)), #dfe3e6; }
        .case-title { font-family: var(--landing-display-font); font-weight: 800; font-size: clamp(18px,2vw,22px); line-height: 1.08; color: #111; }
        .sample-brief { font-size: 13px; line-height: 1.45; color: #444; margin-top: 7px; max-width: 56%; }
        .case-cta { font-size: 13px; font-weight: 600; color: #111; display: inline-flex; align-items: center; gap: 5px; }
        .sample-detail p, .sample-detail li { font-size: 13px; line-height: 1.5; color: #333; }
        .sample-btn { margin-top: auto; display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; padding: 9px 14px; border-radius: 9999px; background: #111; color: #fff; font-size: 13px; font-weight: 600; }
        .sample-btn-alt { display: flex; justify-content: center; padding: 2px 14px 0; font-size: 13px; font-weight: 600; color: #111; text-decoration: underline; text-underline-offset: 4px; text-decoration-color: rgba(0,0,0,.25); }
        /* The posters are 16:9 video frames with a small book centred on grey; at
           six-up that book is a thumbnail of a thumbnail. Crop to 3:2 and zoom
           1.3× so the book fills the tile — an open spread (the widest poster)
           loses ~2% at each edge, a closed cover sits at ~a third of the width. */
        .hero-samples-grid .hero-sample-tile { display: block; overflow: hidden; aspect-ratio: 3 / 2; border-radius: 12px; border: 1px solid rgba(0,0,0,.06); background: #eef1f2; transition: transform .3s ease, box-shadow .3s ease; }
        .hero-samples-grid .hero-sample-tile img { display: block; width: 100%; height: 100%; object-fit: cover; transform: scale(1.3); transform-origin: center; }
        .hero-samples-grid a:hover .hero-sample-tile { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,.10); }
        .hero-eyebrow, .sec-label, .marquee { font-family: var(--font-mono); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #aaa; }
        .best-value-badge { display: inline-flex; align-items: center; justify-content: center; min-height: 22px; border-radius: 9999px; padding: 2px 9px; border: 1px solid rgba(140,94,244,.24); background: linear-gradient(135deg, rgba(140,94,244,.16), rgba(19,184,166,.12) 58%, rgba(218,244,94,.18)); color: #6b35d8; font-size: 11px; font-weight: 800; line-height: 1; box-shadow: inset 0 1px 0 rgba(255,255,255,.75); white-space: nowrap; }
        .create-title { font-family: var(--landing-display-font); }
        .hero-title, .sec-title { font-family: var(--landing-display-font); font-size: clamp(28px, 4vw, 46px); line-height: 1.12; font-weight: 800; }
        .feature-title, .preview-title, .price-figure { font-family: var(--landing-display-font); }
        .hero-sub { margin: 0; font-size: clamp(14px, 1.5vw, 16px); line-height: 1.6; color: #666; }
        .book-mock { box-shadow: 0 2px 8px rgba(0,0,0,.06), 0 30px 80px rgba(0,0,0,.16); }
        .float-card { box-shadow: 0 1px 3px rgba(0,0,0,.04), 0 12px 32px rgba(0,0,0,.12); }
        .wf-line { position: relative; }
        .wf-line::before { content: ''; position: absolute; left: 4px; top: 11px; bottom: 11px; width: 1.5px; background: #e6e7ea; }
        .wf-step { position: relative; display: flex; align-items: center; gap: 9px; padding: 3.5px 0; }
        .wf-dot { width: 9px; height: 9px; border-radius: 9999px; background: #d4d6da; flex: none; position: relative; z-index: 1; transition: background .35s ease, box-shadow .35s ease; }
        .wf-step.is-on .wf-dot { background: #13B8A6; box-shadow: 0 0 0 3px rgba(19,184,166,.18); }
        .wf-step.is-on .wf-label { color: #111; font-weight: 700; }
        @keyframes floaty { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
        .floaty { animation: floaty 5.5s ease-in-out infinite; }
        .card { background: #fff; border-radius: 16px; box-shadow: var(--shadow-card); transition: box-shadow .3s ease, transform .3s ease; }
        .card:hover { box-shadow: var(--shadow-card-hover); transform: translateY(-2px); }
        .faq-item { border-bottom: 1px solid #ebebeb; }
        .faq-q { width: 100%; text-align: left; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 4px; font-family: var(--landing-display-font); font-size: clamp(16px,2vw,19px); font-weight: 800; color: #111; cursor: pointer; }
        .faq-icon { flex-shrink: 0; transition: transform .3s ease; color: #888; }
        .faq-item.open .faq-icon { transform: rotate(45deg); color: #111; }
        .faq-a { overflow: hidden; transition: max-height .3s ease; }
        .faq-a-inner { padding: 0 4px 22px; color: #333; font-size: 15px; line-height: 1.6; max-width: 62ch; }
        .footer-section { overflow: visible; }
        .footer-glow { position: absolute; left: 0; right: 0; bottom: 0; height: 560px; z-index: 0; pointer-events: none; opacity: .65; background: radial-gradient(closest-side, rgba(19,184,166,.26), transparent) 12% 100% / 54% 86% no-repeat, radial-gradient(closest-side, rgba(140,94,244,.22), transparent) 52% 108% / 58% 96% no-repeat, radial-gradient(closest-side, rgba(218,244,94,.28), transparent) 88% 100% / 54% 86% no-repeat; filter: blur(34px); mask-image: linear-gradient(to top, #000 0%, rgba(0,0,0,.72) 42%, transparent 100%); -webkit-mask-image: linear-gradient(to top, #000 0%, rgba(0,0,0,.72) 42%, transparent 100%); }
        @media (min-width: 768px) { .footer-glow { left: 0; right: 0; bottom: 0; height: 680px; filter: blur(42px); } }
      `}</style>

      {/* 液态玻璃的「真折射」:低频平滑噪声 → feDisplacementMap 把导航背后的内容轻微扭曲,
          玻璃才不只是磨砂、而是有厚度的透镜。只挂在**无前缀** backdrop-filter 上 ——
          Safari 的 -webkit- 那条不支持 url() 滤镜,写进去整条 backdrop-filter 会整体失效、
          玻璃当场变成一块半透明白板。所以上面每处都是「-webkit- 纯磨砂 + 无前缀带 url()」两行并列。 */}
      <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
        <filter id="navGlass" x="-120%" y="-160%" width="340%" height="420%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.014 0.018" numOctaves={2} seed={7} result="n" />
          <feGaussianBlur in="n" stdDeviation="0.5" result="ns" />
          <feDisplacementMap in="SourceGraphic" in2="ns" scale={138} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

      <aside className="glass-dock fixed z-[70] flex items-center gap-1 rounded-full p-1.5 bottom-4 left-1/2 -translate-x-1/2 md:bottom-auto md:left-4 md:top-1/2 md:translate-x-0 md:-translate-y-1/2 md:flex-col">
        <Link href={home} aria-label={c.sideHome} className="group relative grid h-9 w-9 place-items-center rounded-full bg-black/[.08] text-[var(--fg)]">
          <Icon name="home" />
          <span className="pointer-events-none absolute left-[calc(100%+10px)] hidden whitespace-nowrap rounded-full bg-[var(--fg)] px-2.5 py-1 text-xs font-medium text-white opacity-0 transition-all group-hover:opacity-100 md:block">{c.sideHome}</span>
        </Link>
        <Link href={`/${locale}/my-albums`} aria-label={c.sideProjects} className="group relative grid h-9 w-9 place-items-center rounded-full text-[var(--muted)] transition-colors hover:bg-black/[.06] hover:text-[var(--fg)]">
          <Icon name="folder" />
          <span className="pointer-events-none absolute left-[calc(100%+10px)] hidden whitespace-nowrap rounded-full bg-[var(--fg)] px-2.5 py-1 text-xs font-medium text-white opacity-0 transition-all group-hover:opacity-100 md:block">{c.sideProjects}</span>
        </Link>
      </aside>

      <header className={`nav-wrap${navScrolled ? ' scrolled' : ''}`}>
        <div className="nav-pill">
          <Link href={home} aria-label="Yujee" className="flex shrink-0 items-center gap-2 pr-1">
            <img src="/logo-yujee.svg" alt="Yujee" className="h-7 w-auto" />
          </Link>
          <div className="hidden items-center gap-0.5 lg:flex">
            <Link href="#outputs" className="nav-link">{c.navExamples}</Link>
            <Link href="#pricing" className="nav-link">{c.navPricing}</Link>
            {/* The only item here that leaves the page, and it earns the slot:
                a reader who is not ready to upload needs somewhere to go that
                is not the back button, and /guides is the only inbound path
                the library has from the strongest page on the site. */}
            <Link href={`/${locale}/guides`} className="nav-link">{c.navGuides}</Link>
            <Link href="#faq" className="nav-link">{c.navFaq}</Link>
          </div>
          <div className="flex items-center gap-1.5 md:gap-2">
            <div className="has-menu hidden md:block">
              <button type="button" className="nav-link" aria-haspopup="true" aria-label={pick(locale, { zh: '切换语言', en: 'Switch language' })}>
                <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
                </svg>
                <span>{currentLanguageLabel}</span>
                <svg aria-hidden className="chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              <div className="nav-pop nav-pop-lang">
                {locales.map((l) => (
                  <Link key={l} href={localizePath(pathname, l)} className={l === locale ? 'is-active' : undefined}>
                    {LOCALE_LABELS[l]}
                  </Link>
                ))}
              </div>
            </div>
            {/* 未确认登录(加载中或已登出)一律显示登录按钮 —— 着陆页访客多为登出态,
                绝不再退化成一个没有登录入口的头像形灰圈(线上偶发卡在加载态的死圈)。
                仅在确认拿到 user 后才切成头像菜单。 */}
            {chromeSession.user ? (
              <UserMenu user={chromeSession.user} locale={locale} />
            ) : (
              <Link href={`/${locale}/login`} className="inline-flex items-center gap-2 rounded-full bg-[var(--fg)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black md:px-5">
                <span>{c.login}</span>
                <ArrowIcon className="h-[15px] w-[15px]" />
              </Link>
            )}
            <button type="button" aria-label={c.menu} aria-expanded={mobileOpen} onClick={() => setMobileOpen((open) => !open)} className="grid h-10 w-10 place-items-center rounded-full transition hover:bg-black/5 lg:hidden">
              <Icon name={mobileOpen ? 'x' : 'menu'} />
            </button>
          </div>
        </div>
        <div className={`m-sheet lg:hidden${mobileOpen ? ' open' : ''}`}>
          <Link href="#outputs">{c.navExamples}</Link>
          <Link href="#pricing">{c.navPricing}</Link>
          <Link href={`/${locale}/guides`}>{c.navGuides}</Link>
          <Link href="#faq">{c.navFaq}</Link>
          {chromeSession.user ? (
            <>
              <Link href={`/${locale}/my-albums`}>{dashboard.nav.myAlbums}</Link>
              <Link href={`/${locale}/credits`}>{chrome.manageSubscription}</Link>
              <Link href={`/${locale}/credits#history`}>{chrome.creditHistory}</Link>
            </>
          ) : (
            <Link href={`/${locale}/login`}>{c.login}</Link>
          )}
          <div className="m-lang">
            {locales.map((l) => (
              <Link key={l} href={localizePath(pathname, l)} className={l === locale ? 'is-active' : undefined}>
                {LOCALE_LABELS[l]}
              </Link>
            ))}
          </div>
        </div>
      </header>

      <main>
        <section className="relative pb-14 pt-32 md:pb-20 md:pt-40">
          <div className="create-glow" aria-hidden="true" />
          <div className="relative mx-auto max-w-3xl px-5 text-center md:px-8">
            <h1 className="create-title mx-auto text-[clamp(30px,5.4vw,54px)] font-bold leading-[1.06]">
              {c.createTitle}
            </h1>
            {c.createSub ? <p className="mx-auto mt-4 max-w-xl text-[clamp(15px,2vw,18px)] leading-[1.55] text-[var(--muted)]">{c.createSub}</p> : null}
          </div>
          <div className="composer-shell relative mx-auto mt-9 max-w-2xl px-5 md:mt-11 md:px-8">
            {composer}
          </div>
          {/* Finished-output proof in the first screen. The July SXO pass scored
              every persona lowest on Trust for one reason: the page asked for
              photos before showing a single finished book. Six posters, each a
              link to its /examples page, sit right under the ask. */}
          {heroSamples.length > 0 && (
            <div className="hero-samples relative mx-auto mt-12 max-w-5xl px-5 md:mt-16 md:px-8">
              <div className="mb-3 flex items-baseline justify-between gap-4">
                <p className="text-sm font-semibold text-[var(--fg-2)]">{c.heroSamplesTitle}</p>
                <Link href={`/${locale}/examples`} className="shrink-0 text-sm text-[var(--muted)] transition hover:text-[var(--fg)]">
                  {c.heroSamplesMore} →
                </Link>
              </div>
              <ul className="hero-samples-grid grid grid-cols-3 gap-3 md:grid-cols-6 md:gap-4">
                {heroSamples.map((sample) => (
                  <li key={sample.slug}>
                    <Link href={sample.href} className="block">
                      <span className="hero-sample-tile">
                        {/* eslint-disable-next-line @next/next/no-img-element -- landing renders plain <img>, not next/image */}
                        <img src={sample.poster} alt={sample.title} width={1280} height={720} loading="lazy" decoding="async" />
                      </span>
                      <span className="mt-2 block text-xs font-medium text-[var(--fg-2)]">{sample.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section id="outputs" className="py-14 md:py-20">
          <div className="wrap">
            <div className="sample-grid gap-4 md:gap-5">
              {c.samples.map((sample) => (
                <SampleCard
                  key={sample.title}
                  sample={sample}
                  sampleCta={c.sampleCta}
                  makeSame={c.makeSame}
                  composerHref={composerHref}
                  exampleHref={`/${locale}/examples/${sample.slug}`}
                />
              ))}
            </div>
            {/* 明示官方演示,不是用户作品 —— 没有这行,样书区读起来就是"客户案例"
                (Creem 审核 2026-07-15 据此判定 social proof:账上零客户,页面却在展示
                六本"成书")。标注后它是产品演示,不再是社交证明。放网格下方,小字。 */}
            <p className="mt-4 text-center text-xs text-[var(--meta)]">{c.samplesNote}</p>
            <p className="mt-3 text-center">
              <Link href={`/${locale}/examples`} className="text-sm font-semibold text-[var(--fg)] underline-offset-4 hover:underline">
                {c.heroSamplesMore} →
              </Link>
            </p>
          </div>
        </section>

        <section className="relative overflow-hidden py-16 md:py-24">
          <div className="wrap">
            <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-8">
              <div className="lg:col-span-6">
                <div className="hero-eyebrow mb-5">{c.heroEyebrow}</div>
                <h2 className="hero-title max-w-[520px]">{c.heroTitle}</h2>
                <p className="hero-sub mt-6 max-w-md">{c.heroSub}</p>
                <div className="mt-9 flex flex-wrap items-center gap-3">
                  <span className="btn-glow">
                    <Link href={composerHref} className="inline-flex items-center gap-2 rounded-full bg-[var(--fg)] px-7 py-3.5 text-base font-semibold text-white">
                      <span>{c.heroCta}</span>
                      <ArrowIcon className="h-[17px] w-[17px]" />
                    </Link>
                  </span>
                  <Link href="#outputs" className="inline-flex items-center gap-2 rounded-full border border-black/15 px-6 py-3.5 text-base font-semibold text-[var(--fg)] transition hover:bg-black/5">
                    {c.heroExamples}
                  </Link>
                </div>
                <div className="marquee mt-9 flex flex-wrap gap-x-6 gap-y-2 normal-case">
                  {c.trust.map((item) => (
                    <span key={item}>· {item}</span>
                  ))}
                </div>
              </div>

              <div className="relative lg:col-span-6">
                <div className="relative mx-auto max-w-[520px]">
                  <div className="book-mock overflow-hidden rounded-2xl bg-gradient-to-b from-white to-[#fafafa]" style={{ transform: 'perspective(1600px) rotateY(-14deg) rotateX(3deg)' }}>
                    <div className="grid grid-cols-2">
                      <div className="border-r border-black/5 p-4">
                        <img src={preview.left} alt="" className="aspect-[3/4] w-full rounded-xl object-cover transition-opacity duration-500" />
                        <div className="mt-3 h-2.5 w-3/4 rounded-full bg-black/10" />
                        <div className="mt-2 h-2 w-1/2 rounded-full bg-black/5" />
                      </div>
                      <div className="p-4">
                        <div className="marquee mb-2 text-[11px]">Group 0{activePreview + 1}</div>
                        <div className="preview-title mb-2 text-lg font-bold leading-tight">{preview.title}</div>
                        <img src={preview.right} alt="" className="mb-3 aspect-[4/3] w-full rounded-xl object-cover transition-opacity duration-500" />
                        <div className="space-y-1.5">
                          <div className="h-2 w-full rounded-full bg-black/10" />
                          <div className="h-2 w-5/6 rounded-full bg-black/10" />
                          <div className="h-2 w-2/3 rounded-full bg-black/5" />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="float-card floaty absolute -left-4 bottom-10 hidden w-[210px] rounded-2xl bg-white px-4 py-3.5 sm:block md:-left-10">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)]" />
                      <span className="text-xs font-semibold text-[var(--fg-2)]">{c.workflowTitle}</span>
                    </div>
                    <div className="wf-line">
                      {c.workflow.map((step, index) => (
                        <button key={step} type="button" className={`wf-step w-full text-left${index === activePreview ? ' is-on' : ''}`} onClick={() => setActivePreview(index)}>
                          <span className="wf-dot" />
                          <span className="wf-label text-xs leading-snug text-[#8a8f98]">{step}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="float-card floaty absolute -right-3 top-6 hidden items-center gap-2.5 rounded-full bg-white py-2 pl-2 pr-4 sm:flex md:-right-8" style={{ animationDelay: '-2.5s' }}>
                    <img src="/landing-redesign/jellyfish-loop.png" alt="" className="h-7 w-7 object-contain" />
                    <span className="text-[12px] font-medium text-[var(--fg-2)]">{c.polish}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="py-16 md:py-24">
          <div className="wrap">
            <div className="mb-12 max-w-2xl md:mb-16">
              <div className="sec-label mb-4">{c.featuresLabel}</div>
              <h2 className="sec-title">{c.featuresTitle}</h2>
            </div>
            <div className="grid gap-5 md:grid-cols-3 md:gap-6">
              {c.features.map((feature) => (
                <article key={feature.title} className="card p-7">
                  <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--bg)]">
                    <Icon name={feature.icon} />
                  </div>
                  <h3 className="feature-title mb-2 text-xl font-bold">{feature.title}</h3>
                  <p className="text-[15px] leading-relaxed text-[var(--fg-2)]">{feature.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <LandingPricing locale={locale} />

        <section className="py-20 md:py-28">
          <div className="wrap text-center">
            <h2 className="sec-title mx-auto max-w-3xl">{c.ctaTitle}</h2>
            <p className="mx-auto mt-5 max-w-xl text-lg text-[var(--fg-2)]">{c.ctaSub}</p>
            <div className="mt-9">
              <span className="btn-glow">
                <Link href={composerHref} className="inline-flex items-center gap-2 rounded-full bg-[var(--fg)] px-7 py-3.5 text-base font-semibold text-white">
                  {c.start}
                  <ArrowIcon className="h-[17px] w-[17px]" />
                </Link>
              </span>
            </div>
          </div>
        </section>

        <section id="faq" className="pb-20 md:pb-28">
          <div className="mx-auto max-w-3xl px-5 md:px-8">
            <div className="sec-label mb-4">{c.faqLabel}</div>
            <h2 className="sec-title mb-10">{c.faqTitle}</h2>
            <div>
              {c.faq.map((item, index) => (
                <FAQItem
                  key={item.q}
                  q={item.q}
                  a={item.a}
                  open={openFaq === index}
                  onToggle={() => setOpenFaq((open) => (open === index ? null : index))}
                />
              ))}
            </div>
          </div>
        </section>

        <footer className="footer-section relative pb-10 pt-14">
          <div className="footer-glow" aria-hidden="true" />
          <div className="wrap relative z-10">
            <div className="mb-12 grid grid-cols-2 gap-8 md:grid-cols-5 md:gap-6">
              <div className="col-span-2 md:col-span-1">
                <img src="/logo-yujee.svg" alt="Yujee" className="mb-4 h-7 w-auto" />
                <p className="max-w-[200px] text-sm leading-relaxed text-[var(--muted)]">{c.footerTagline}</p>
              </div>
              <FooterColumn title={c.footerProduct} links={[
                [c.featuresLabel, '#features'],
                [c.navExamples, `/${locale}/examples`],
                [c.heroCta, composerHref],
                // The real page, not the on-page anchor. The nav keeps #pricing
                // (the buy block is right here), but the footer is the landing's
                // ONLY link into /pricing — the shared MarketingFooter got one in
                // c4148143 and the redesigned home never renders that footer, so
                // the money page had zero inbound links from the strongest page.
                [c.navPricing, `/${locale}/pricing`],
              ]} />
              {/* Only link to surfaces that exist. "使用指南" / "模板库" used to sit here
                  pointing at #features / #outputs — the pages were never built, so clicking
                  them just scrolled back to "它能做什么". Worse than a 404, which at least
                  tells the truth. Re-add each label the day its page ships. The example
                  links below shipped with /examples; their labels double as the search
                  terms those pages target. */}
              <FooterColumn title={c.footerResources} links={[
                [c.footerExampleTravel, `/${locale}/examples/travel-journal`],
                [c.footerExampleLifeStory, `/${locale}/examples/life-story`],
                [c.footerExamplesAll, `/${locale}/examples`],
                // "使用指南" is back, and this time the pages are real: seven
                // articles under /guides. This is the landing's ONLY link into
                // them — the shared MarketingFooter has carried the entry all
                // along, but the redesigned home renders this footer instead, so
                // the library sat with zero inbound links from the strongest
                // page on the site.
                [c.footerGuides, `/${locale}/guides`],
                [c.navFaq, '#faq'],
              ]} />
              {/* "关于" is back, and this time it goes somewhere: the founder story
                  shipped. It leads the column because it is the only entry here a
                  reader would open on purpose. */}
              <FooterColumn title={c.footerCompany} links={[
                [c.footerStory, `/${locale}/about/story`],
                [c.footerPrivacy, `/${locale}/privacy`],
                [c.footerTerms, `/${locale}/terms`],
              ]} />
              <FooterColumn title={c.footerAccount} links={accountLinks} />
            </div>
            <div className="flex flex-col items-start justify-between gap-4 pt-8 sm:flex-row sm:items-center">
              <div className="text-xs text-[var(--meta)]">{c.copyright}</div>
              {/* Accounts come from @/config/social — an entry with no href is not
                  rendered. The Weibo icon that used to sit here pointed at weibo.com's
                  homepage, not an account. Email is always real, so it always shows. */}
              <div className="flex items-center gap-3">
                {SOCIAL_LINKS.filter((s) => s.href).map((s) => (
                  <a
                    key={s.label}
                    href={s.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={s.label}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[var(--muted)] shadow-[var(--shadow-card)] transition hover:text-[var(--fg)]"
                  >
                    <svg aria-hidden width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                      <path d={s.path} />
                    </svg>
                  </a>
                ))}
                <a href={`mailto:${SUPPORT_EMAIL}`} aria-label="Email" className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[var(--muted)] shadow-[var(--shadow-card)] transition hover:text-[var(--fg)]">
                  <svg aria-hidden width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="m3 7 9 6 9-6" />
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

function FooterColumn({ title, links }: { title: string; links: Array<[string, string]> }) {
  return (
    <div>
      <div className="sec-label mb-4">{title}</div>
      <ul className="space-y-2.5 text-sm text-[var(--fg-2)]">
        {links.map(([label, href]) => (
          <li key={`${label}-${href}`}>
            <Link href={href} className="transition hover:text-[var(--fg)]">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
