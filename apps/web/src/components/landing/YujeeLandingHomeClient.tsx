'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { UserMenu } from '@/components/app/UserMenu';
import { useChromeSession } from '@/components/app/useChromeSession';
import { ADDON_PACKS, PHOTOS_PER_CREDIT } from '@/config/pricing';
import { SOCIAL_LINKS, SUPPORT_EMAIL } from '@/config/social';
import { useSession } from '@/lib/auth/client';
import { getMessages } from '@/lib/i18n/messages';
import { localizePath, type Locale } from '@/lib/i18n/routing';
import { getFaqEntries } from '@/lib/seo/faq';

// Pricing copy states the rule through a {photos} token so the number can only
// ever come from PHOTOS_PER_CREDIT. Rendering the raw message would ship the
// literal "{photos}" to users — which is exactly what happened once.
const withPhotoRule = (copy: string) => copy.replaceAll('{photos}', String(PHOTOS_PER_CREDIT));

type Props = {
  locale: Locale;
  composer: ReactNode;
};

type Sample = {
  title: string;
  brief: string;
  body: string;
  bullets: string[];
  image: string;
  video: string;
};

type PreviewChapter = {
  title: string;
  left: string;
  right: string;
};

type Copy = {
  sideHome: string;
  sideProjects: string;
  navExamples: string;
  navPricing: string;
  navFaq: string;
  login: string;
  menu: string;
  createTitle: string;
  createSub: string;
  sampleCta: string;
  makeSame: string;
  heroEyebrow: string;
  heroTitle: ReactNode;
  heroSub: string;
  heroCta: string;
  heroExamples: string;
  trust: string[];
  workflowTitle: string;
  workflow: string[];
  polish: string;
  featuresLabel: string;
  featuresTitle: ReactNode;
  features: { title: string; body: string; icon: 'layout' | 'spark' | 'book' }[];
  ctaTitle: string;
  ctaSub: string;
  start: string;
  faqLabel: string;
  faqTitle: string;
  faq: { q: string; a: ReactNode }[];
  footerTagline: string;
  footerProduct: string;
  footerResources: string;
  footerCompany: string;
  footerAccount: string;
  footerPrivacy: string;
  footerTerms: string;
  signup: string;
  copyright: string;
  samples: Sample[];
  previewChapters: PreviewChapter[];
};

/**
 * The FAQ prose lives in @/lib/seo/faq — the same module the FAQPage JSON-LD
 * serialises. Rendering both from one source means the structured data can never
 * claim something the page doesn't actually say.
 *
 * The pricing link is presentation, so it's appended here rather than baked into
 * the schema text (JSON-LD answers must be markup-free).
 */
function buildFaq(locale: Locale, pricingLabel: string): { q: string; a: ReactNode }[] {
  const entries = getFaqEntries(locale);

  return entries.map((entry, index) => {
    const isLast = index === entries.length - 1;
    if (!isLast) return { q: entry.q, a: entry.a };

    return {
      q: entry.q,
      a: (
        <>
          {entry.a}{' '}
          <Link href={`${localizePath('/', locale)}#pricing`} className="underline underline-offset-2">
            {pricingLabel}
          </Link>
        </>
      ),
    };
  });
}

const copies: Record<Locale, Copy> = {
  en: {
    sideHome: 'Home',
    sideProjects: 'My projects',
    navExamples: 'Examples',
    navPricing: 'Pricing',
    navFaq: 'FAQ',
    login: 'Log in',
    menu: 'Menu',
    createTitle: 'Turn your scattered photos into a magazine you can read, touch, and keep',
    createSub: '',
    sampleCta: 'See example',
    makeSame: 'Make one like this',
    heroEyebrow: 'AI photo books · from shots to bound book',
    heroTitle: (
      <>
        Turn your everyday snapshots
        <br />
        into a book that&apos;s yours alone
      </>
    ),
    heroSub: 'YUJEE AI turns your photos, stories, memories and ideas into a beautiful magazine made just for you.',
    heroCta: 'Start creating',
    heroExamples: 'See examples',
    trust: ['No design skills needed', 'Fully editable', 'HD-ready export'],
    workflowTitle: 'How it works',
    workflow: ['Auto photo grouping', 'AI-assisted writing', 'Auto design'],
    polish: 'Polishing the text…',
    featuresLabel: 'What it does',
    featuresTitle: (
      <>
        Spend less time sorting,
        <br />
        more time remembering
      </>
    ),
    features: [
      {
        title: 'Auto-layout into a book',
        body:
          'Drop in a set of photos and the AI lays out spreads with rhythm — full bleeds, grids, white space — no dragging one by one.',
        icon: 'layout',
      },
      {
        title: 'Smart groups + captions',
        body:
          'It detects time and scenes to group your photos automatically, and drafts an editable title and description for each. You set the tone; it writes the first draft.',
        icon: 'spark',
      },
      {
        title: 'Flip-book preview · HD export',
        body:
          'Flip through a 3D preview, page by page — what you see is what you get. Export a 300 DPI print-ready PDF you can print and bind anytime.',
        icon: 'book',
      },
    ],
    ctaTitle: "Don't leave those photos in a folder",
    ctaSub: 'Make your first book in minutes. Start free; think about export and print once you love it.',
    start: 'Start free',
    faqLabel: 'FAQ',
    faqTitle: 'Still on the fence?',
    faq: buildFaq('en', 'See pricing'),
    footerTagline: 'Turn your photos into a beautifully designed album.',
    footerProduct: 'Product',
    footerResources: 'Resources',
    footerCompany: 'Company',
    footerAccount: 'Account',
    footerPrivacy: 'Privacy',
    footerTerms: 'Terms',
    signup: 'Sign up free',
    copyright: '© 2026 Yujee · Memories, beautifully laid out',
    samples: [
      {
        title: 'Year in a book',
        brief: 'One book a year, bound each December',
        body:
          'Pack a whole year into one book. Holidays, trips, and everyday moments are laid out by month and continued year after year.',
        bullets: ['Grouped by month or event', 'One click for the year-end book', 'Same style, a matching set each year'],
        image: '/landing-redesign/cards/03-year-record.png',
        video: '/landing-redesign/cards/03-year-record.mp4',
      },
      {
        title: 'Life story',
        brief: 'Your milestones, into a life story',
        body:
          'Lay milestones along a timeline: birth, school, people, and journeys. Each group gets editable short essays, bound like a biography.',
        bullets: ['Auto-grouped by life stage', 'Long-form text and pull quotes per group', 'Great as a birthday or memorial gift'],
        image: '/landing-redesign/cards/02-life-story.png',
        video: '/landing-redesign/cards/02-life-story.mp4',
      },
      {
        title: 'Travel',
        brief: 'A trip, auto-bound into a journal',
        body:
          'Auto-grouped by date, with places and order sorted for you. One spread per day, with room to breathe between photos.',
        bullets: ['Auto-split by timeline', 'Add map pages and route notes', 'Export a PDF to share with travel mates'],
        image: '/landing-redesign/cards/01-travel.png',
        video: '/landing-redesign/cards/01-travel.mp4',
      },
      {
        title: 'Portfolio',
        brief: 'Your work, lined up quietly',
        body:
          'Photography, illustration, design: aligned to a grid with consistent margins so the work stays the star.',
        bullets: ['Strict grid and uniform margins', 'Title, medium, and year per page', 'Export a submittable PDF portfolio'],
        image: '/landing-redesign/cards/06-portfolio.png',
        video: '/landing-redesign/cards/06-portfolio.mp4',
      },
      {
        title: 'Magazine',
        brief: 'Lay content out like a real magazine',
        body:
          'More than an album: cover, contents, features, and pull quotes on a magazine skeleton. Turn life into an issue.',
        bullets: ['Cover, contents, and feature templates', 'Editorial layout with headlines and quotes', 'Print-ready export for a physical issue'],
        image: '/landing-redesign/cards/05-magazine.png',
        video: '/landing-redesign/cards/05-magazine.mp4',
      },
      {
        title: 'Growth story',
        brief: 'A page a month, every change',
        body:
          'Filed by month into a growth timeline. Quick notes like height, weight, and firsts land on the right page.',
        bullets: ['Auto-grouped by month or milestone', 'Add little data cards', 'Keep adding; the album grows over time'],
        image: '/landing-redesign/cards/04-growth-story.png',
        video: '/landing-redesign/cards/04-growth-story.mp4',
      },
    ],
    previewChapters: [
      {
        title: 'Morning departure',
        left: '/landing-redesign/photos/bamboo-grove-path.jpg',
        right: '/landing-redesign/photos/riverside-walk.jpg',
      },
      {
        title: 'Summer Coastline',
        left: '/landing-redesign/photos/kamakura-coastal-street.jpg',
        right: '/landing-redesign/photos/seto-inland-sea-pier.jpg',
      },
      {
        title: 'The way back',
        left: '/landing-redesign/photos/rainy-kyoto-lane.jpg',
        right: '/landing-redesign/photos/riverside-before-fireworks.jpg',
      },
    ],
  },
  zh: {
    sideHome: '主页',
    sideProjects: '我的项目',
    navExamples: '示例',
    navPricing: '定价',
    navFaq: '常见问题',
    login: '登录',
    menu: '菜单',
    createTitle: '把散落的照片，做成一本能读、能摸、能留的杂志',
    createSub: 'YUJEE AI 将您的照片、故事、回忆和想法变成一本专为您制作的精美杂志。',
    sampleCta: '查看示例',
    makeSame: '做同款',
    heroEyebrow: 'AI 相册创作 · 从照片到成册',
    heroTitle: (
      <>
        把随手一拍的照片，
        <br />
        整理成只属于你的书
      </>
    ),
    heroSub: '你来讲故事，故事润色、排版、设计，通通交给 Yujee。',
    heroCta: '开始创作',
    heroExamples: '看看示例',
    trust: ['无需设计基础', '全程可编辑', '导出高清成品'],
    workflowTitle: '创作工作流',
    workflow: ['自动识图分组', 'AI 辅助内容撰写', '自动设计'],
    polish: '正在润色文字…',
    featuresLabel: '它能做什么',
    featuresTitle: (
      <>
        把整理照片的力气，
        <br />
        省下来给回忆
      </>
    ),
    features: [
      {
        title: '自动排版成册',
        body: '丢进一组照片，AI 按节奏排好跨页版式：大图、网格、留白，疏密有致，不用一张张拖。',
        icon: 'layout',
      },
      {
        title: '智能分组 + 配文',
        body: '识别时间与场景自动分组，为每一组生成可编辑的标题和描述。文字你来定调，初稿它先写好。',
        icon: 'spark',
      },
      {
        title: '翻书预览 · 高清导出',
        body: '3D 翻书逐页预览，所见即所得。导出 300DPI 印刷级 PDF，随时打印装订成实体相册。',
        icon: 'book',
      },
    ],
    ctaTitle: '那些照片，别再躺在相册里了',
    ctaSub: '几分钟，做出第一本。免费开始，满意了再导出打印。',
    start: '免费开始',
    faqLabel: '常见问题',
    faqTitle: '还在犹豫？',
    faq: buildFaq('zh', '查看定价'),
    footerTagline: '把照片做成一本设计好的相册。',
    footerProduct: '产品',
    footerResources: '资源',
    footerCompany: '公司',
    footerAccount: '账户',
    footerPrivacy: '隐私政策',
    footerTerms: '服务条款',
    signup: '免费注册',
    copyright: '© 2026 Yujee · 用排版，把回忆收好',
    samples: [
      {
        title: '年纪记录',
        brief: '一年一本，年底自动成册',
        body: '把一整年塞进一本。节日、出游、日常按月铺开，年底一键成册，年年续上一本。',
        bullets: ['按月 / 按事件自动归类', '年底一键生成年度册', '风格沿用，逐年成套'],
        image: '/landing-redesign/cards/03-year-record.png',
        video: '/landing-redesign/cards/03-year-record.mp4',
      },
      {
        title: '人生故事',
        brief: '把人生节点，排成一本传记',
        body: '按时间轴铺开重要节点：出生、求学、相遇、远行。每段配一篇可编辑短文，做成传记式相册。',
        bullets: ['按人生阶段自动分组', '每组可配长文与引言', '适合做生日 / 纪念礼物'],
        image: '/landing-redesign/cards/02-life-story.png',
        video: '/landing-redesign/cards/02-life-story.mp4',
      },
      {
        title: '旅行',
        brief: '一趟旅行，自动收成一本游记',
        body: '按日期自动分组，地点、天气、行程顺序都帮你理好。每一天一个跨页，照片之间留出呼吸。',
        bullets: ['按时间线自动分日分组', '可加地图页与路线标注', '导出 PDF，和旅伴一起翻看'],
        image: '/landing-redesign/cards/01-travel.png',
        video: '/landing-redesign/cards/01-travel.mp4',
      },
      {
        title: '作品集',
        brief: '让作品安静地排成一册',
        body: '摄影、插画、设计：网格对齐、统一留白，弱化装饰，让作品本身是主角。',
        bullets: ['严格网格与统一边距', '每页可附标题 / 媒介 / 年份', '导出可直接投递的 PDF 作品集'],
        image: '/landing-redesign/cards/06-portfolio.png',
        video: '/landing-redesign/cards/06-portfolio.mp4',
      },
      {
        title: '杂志',
        brief: '把内容排成一本杂志感的刊物',
        body: '不只是相册：封面、目录、专题、引言，按真正的杂志骨架排版，把生活做成一期刊物。',
        bullets: ['封面 / 目录 / 专题模板', '大标题 + 引言的编辑式排版', '导出印刷级，可做成实体刊'],
        image: '/landing-redesign/cards/05-magazine.png',
        video: '/landing-redesign/cards/05-magazine.mp4',
      },
      {
        title: '成长故事',
        brief: '一月一页，记下 TA 的变化',
        body: '按月份归档，自动生成成长时间线。身高体重、第一次的瞬间，都能落在对应的页上。',
        bullets: ['按月 / 按里程碑自动归组', '可加身高体重等小数据卡', '持续添加，相册随时间长大'],
        image: '/landing-redesign/cards/04-growth-story.png',
        video: '/landing-redesign/cards/04-growth-story.mp4',
      },
    ],
    previewChapters: [
      {
        title: '出发的清晨',
        left: '/landing-redesign/photos/bamboo-grove-path.jpg',
        right: '/landing-redesign/photos/riverside-walk.jpg',
      },
      {
        title: '夏天的海岸线',
        left: '/landing-redesign/photos/kamakura-coastal-street.jpg',
        right: '/landing-redesign/photos/seto-inland-sea-pier.jpg',
      },
      {
        title: '回程',
        left: '/landing-redesign/photos/rainy-kyoto-lane.jpg',
        right: '/landing-redesign/photos/riverside-before-fireworks.jpg',
      },
    ],
  },
};

const languageOptions: Locale[] = ['zh', 'en'];

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
}: {
  sample: Sample;
  sampleCta: string;
  makeSame: string;
  composerHref: string;
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
        <span className="case-cta">
          {sampleCta}
          <ArrowIcon className="h-3.5 w-3.5" />
        </span>
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
        <Link href={composerHref} className="sample-btn">
          {makeSame}
          <ArrowIcon className="h-[15px] w-[15px]" />
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
  const priceRule = withPhotoRule(t.creditRule);
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
          <div className="sec-label">{locale === 'zh' ? '价格' : 'Pricing'}</div>
          <h2 className="sec-title mt-3">{priceTitle}</h2>
          <p className="mt-3 text-sm text-[var(--muted)]">{priceSubtitle}</p>
          <p className="mt-1.5 text-xs text-[var(--meta)]">{priceRule}</p>
        </div>
        {err && <p className="mb-5 text-center text-sm text-red-600">{err}</p>}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-5">
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
                    {pack.books.toLocaleString(locale)} {pack.books === 1 ? t.unitSingular : t.unit}
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

export function YujeeLandingHomeClient({ locale, composer }: Props) {
  const c = copies[locale];
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
  const currentLanguageLabel = locale === 'zh' ? '中文' : 'English';
  const accountLinks: Array<[string, string]> = chromeSession.loading
    ? [[c.signup, composerHref]]
    : chromeSession.user
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
        .nav-wrap { position: fixed; top: 0; left: 0; right: 0; z-index: 50; display: flex; justify-content: center; padding: 0 16px; transition: padding .35s ease; }
        .nav-wrap.scrolled { padding: 10px 16px; }
        .nav-pill { width: 100%; max-width: 1320px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; border: 1px solid transparent; background: transparent; transition: max-width .4s ease, padding .35s ease, border-radius .35s ease, background .35s ease, box-shadow .35s ease, border-color .35s ease; }
        .nav-wrap.scrolled .nav-pill { max-width: 1120px; padding: 8px 12px 8px 18px; border-radius: 9999px; background: rgba(255,255,255,.72); backdrop-filter: blur(22px) saturate(180%); box-shadow: 0 4px 24px rgba(0,0,0,.08), inset 0 1px 0 rgba(255,255,255,.9); border-color: rgba(0,0,0,.05); }
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

      <aside className="fixed z-[70] flex items-center gap-1 rounded-full bg-white/45 p-1.5 shadow-[0_1px_4px_rgba(0,0,0,.06),0_4px_12px_rgba(0,0,0,.04)] backdrop-blur-xl bottom-4 left-1/2 -translate-x-1/2 md:bottom-auto md:left-4 md:top-1/2 md:translate-x-0 md:-translate-y-1/2 md:flex-col">
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
            <Link href="#faq" className="nav-link">{c.navFaq}</Link>
          </div>
          <div className="flex items-center gap-1.5 md:gap-2">
            <div className="has-menu hidden md:block">
              <button type="button" className="nav-link" aria-haspopup="true" aria-label={locale === 'zh' ? '切换语言' : 'Switch language'}>
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
                {languageOptions.map((l) => (
                  <Link key={l} href={localizePath(pathname, l)} className={l === locale ? 'is-active' : undefined}>
                    {l === 'zh' ? '中文' : 'English'}
                  </Link>
                ))}
              </div>
            </div>
            {chromeSession.loading ? (
              <span aria-hidden="true" className="h-10 w-10 rounded-full bg-[#ececec] shadow-sm" />
            ) : !chromeSession.user ? (
              <Link href={`/${locale}/login`} className="inline-flex items-center gap-2 rounded-full bg-[var(--fg)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black md:px-5">
                <span>{c.login}</span>
                <ArrowIcon className="h-[15px] w-[15px]" />
              </Link>
            ) : (
              <UserMenu user={chromeSession.user} locale={locale} />
            )}
            <button type="button" aria-label={c.menu} aria-expanded={mobileOpen} onClick={() => setMobileOpen((open) => !open)} className="grid h-10 w-10 place-items-center rounded-full transition hover:bg-black/5 lg:hidden">
              <Icon name={mobileOpen ? 'x' : 'menu'} />
            </button>
          </div>
        </div>
        <div className={`m-sheet lg:hidden${mobileOpen ? ' open' : ''}`}>
          <Link href="#outputs">{c.navExamples}</Link>
          <Link href="#pricing">{c.navPricing}</Link>
          <Link href="#faq">{c.navFaq}</Link>
          {chromeSession.loading ? null : !chromeSession.user ? (
            <Link href={`/${locale}/login`}>{c.login}</Link>
          ) : (
            <>
              <Link href={`/${locale}/my-albums`}>{dashboard.nav.myAlbums}</Link>
              <Link href={`/${locale}/credits`}>{chrome.manageSubscription}</Link>
              <Link href={`/${locale}/credits#history`}>{chrome.creditHistory}</Link>
            </>
          )}
          <div className="m-lang">
            {languageOptions.map((l) => (
              <Link key={l} href={localizePath(pathname, l)} className={l === locale ? 'is-active' : undefined}>
                {l === 'zh' ? '中文' : 'English'}
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
                />
              ))}
            </div>
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
                [c.navExamples, '#outputs'],
                [c.heroCta, composerHref],
                [c.navPricing, '#pricing'],
              ]} />
              {/* Only link to surfaces that exist. "使用指南" / "模板库" / "关于" used to
                  sit here pointing at #features / #outputs — the pages were never built, so
                  clicking "关于" just scrolled back to "它能做什么". Worse than a 404, which
                  at least tells the truth. Re-add each label the day its page ships. */}
              <FooterColumn title={c.footerResources} links={[
                [c.navFaq, '#faq'],
              ]} />
              <FooterColumn title={c.footerCompany} links={[
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
