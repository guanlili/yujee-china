import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..', '..', '..');
const webSrc = join(webRoot, 'src');

function src(path: string): string {
  return readFileSync(join(webSrc, path), 'utf8');
}

function component(path: string): string {
  return readFileSync(join(here, path), 'utf8');
}

const landingAssets = [
  '/landing-redesign/cards/01-travel.png',
  '/landing-redesign/cards/02-life-story.png',
  '/landing-redesign/cards/03-year-record.png',
  '/landing-redesign/cards/04-growth-story.png',
  '/landing-redesign/cards/05-magazine.png',
  '/landing-redesign/cards/06-portfolio.png',
  '/landing-redesign/cards/01-travel.mp4',
  '/landing-redesign/cards/02-life-story.mp4',
  '/landing-redesign/cards/03-year-record.mp4',
  '/landing-redesign/cards/04-growth-story.mp4',
  '/landing-redesign/cards/05-magazine.mp4',
  '/landing-redesign/cards/06-portfolio.mp4',
  '/landing-redesign/photos/kamakura-coastal-street.jpg',
  '/landing-redesign/photos/seto-inland-sea-pier.jpg',
  '/landing-redesign/photos/bamboo-grove-path.jpg',
  '/landing-redesign/photos/riverside-walk.jpg',
  '/landing-redesign/photos/riverside-before-fireworks.jpg',
  '/landing-redesign/photos/rainy-kyoto-lane.jpg',
  '/landing-redesign/jellyfish-loop.png',
];

test('locale homepage is replaced by the supplied landing redesign component', () => {
  const page = src('app/[locale]/page.tsx');
  const globals = src('styles/globals.css');
  const home = component('YujeeLandingHome.tsx');
  const client = component('YujeeLandingHomeClient.tsx');

  assert.match(page, /YujeeLandingHome/, 'locale home should render the redesign component');
  assert.doesNotMatch(page, /MarketingChrome|FingerprintArt|InspirationMarquee/, 'old home sections should be removed');
  assert.match(home, /HeroComposer/, 'redesigned composer should keep the real upload/generation flow');
  assert.match(home, /variant="redesign"/, 'home should use the landing redesign composer skin');
  assert.match(client, /id="outputs"/, 'examples section should keep the design anchor');
  assert.match(client, /id="features"/, 'features section should keep the design anchor');
  assert.match(client, /id="faq"/, 'FAQ section should keep the design anchor');
  assert.match(client, /function LandingPricing/, 'pricing should use the compact supplied landing design');
  assert.match(client, /\/api\/v1\/billing\/checkout/, 'pricing should keep the real checkout flow');
  assert.match(client, /className="has-menu hidden md:block"/, 'desktop language control should keep the supplied dropdown shape');
  assert.match(client, /\.m-lang a\.is-active \{ background: #111; color: #fff; \}/, 'mobile active language button should stay readable');
  // Social icons come from @/config/social, which renders nothing for an account
  // that doesn't exist. This assertion used to demand a hardcoded Weibo icon —
  // whose href was weibo.com's homepage, i.e. dead on click. Never pin a
  // placeholder in a test; pin the source of truth instead.
  assert.match(client, /SOCIAL_LINKS\.filter\(\(s\) => s\.href\)/, 'footer should render only social accounts that exist');
  assert.doesNotMatch(client, /href="https:\/\/weibo\.com"/, 'footer must not link a platform homepage as if it were an account');
  assert.match(client, /aria-label="Email"/, 'footer should keep the supplied email social icon');
  assert.match(client, /className="footer-glow"/, 'footer should include the requested bottom color accent');
  assert.match(client, /\.footer-glow \{[^}]*opacity: \.65;/s, 'footer color accent should use 65% opacity');
  assert.match(globals, /font-family: 'Playfair Display'/, 'art display font should be registered from local assets');
  assert.match(globals, /\/fonts\/PlayfairDisplay\.ttf/, 'art display font should load from the local Yujee font folder');
  assert.match(globals, /font-family: 'Noto Serif SC Landing'/, 'Chinese landing emphasis should register the local CJK serif subset');
  assert.match(globals, /\/fonts\/NotoSerifSC-Landing\.woff2/, 'Chinese landing emphasis should load the optimized local CJK subset');
  assert.match(client, /--landing-art-font: 'Playfair Display'/, 'English landing emphasis should use the local art font');
  assert.match(client, /--landing-cjk-art-font: 'Playfair Display', 'Noto Serif SC Landing', 'Songti SC'/, 'Chinese landing emphasis should use the same art-font stack with local CJK fallback');
  assert.match(client, /--landing-display-font: var\(--landing-cjk-art-font\);/, 'all landing title typography should switch to the art font stack');
  assert.doesNotMatch(client, /locale-en \{ --landing-display-font/, 'art title typography should no longer be English-only');
  assert.match(client, /className="price-figure/, 'pricing emphasis should receive the English art font treatment');
  assert.match(client, /\.footer-glow \{[^}]*mask-image: linear-gradient\(to top, #000 0%, rgba\(0,0,0,\.72\) 42%, transparent 100%\);/s, 'footer color accent should fade upward from the bottom');
  const cjkSubset = join(webRoot, 'public/fonts/NotoSerifSC-Landing.woff2');
  assert.equal(existsSync(cjkSubset), true, 'landing CJK serif subset should be available as a public asset');
  assert.ok(statSync(cjkSubset).size < 120_000, 'landing CJK serif subset should stay optimized for the homepage');
  assert.equal(existsSync(join(webRoot, 'public/fonts/NotoSerifSC-Landing-OFL.txt')), true, 'public CJK font subset should ship with its OFL text');
  assert.doesNotMatch(`${home}\n${client}`, /design\/(?:editor|pricing|login)\.html|landing\.html|index\.html/, 'static design links must be replaced with real app routes');
  assert.match(client, /`\/\$\{locale\}\/login`/, 'login CTA should point at the localized login route');
  assert.match(client, /`\/\$\{locale\}\/my-albums`/, 'my projects should point at the localized albums route');
  assert.match(client, /`\/\$\{locale\}\/privacy`/, 'privacy footer link should point at the real route');
  assert.match(client, /`\/\$\{locale\}\/terms`/, 'terms footer link should point at the real route');
});

test('landing header replaces the login CTA with the account menu for signed-in users', () => {
  const client = component('YujeeLandingHomeClient.tsx');
  const userMenu = readFileSync(join(webSrc, 'components/app/UserMenu.tsx'), 'utf8');
  const creditsPage = src('app/[locale]/credits/page.tsx');
  const enMessages = src('messages/en.json');
  const zhMessages = src('messages/zh.json');

  assert.match(client, /useChromeSession/, 'landing header should read the real chrome session');
  assert.match(client, /<UserMenu user=\{chromeSession\.user\} locale=\{locale\}/, 'signed-in landing users should see the shared account menu');
  // 修复(线上 bug):登出/加载态不再退化成头像形灰圈 —— 登录 CTA 是「未确认登录」的默认态,
  // 仅在确认拿到 user 后才切成 UserMenu。所以 CTA 用 `chromeSession.user ? <UserMenu> : <login>`。
  assert.match(client, /chromeSession\.user \?[\s\S]{0,160}<UserMenu[\s\S]{0,240}`\/\$\{locale\}\/login`/, 'login CTA is the fallback whenever there is no confirmed signed-in user (including while loading)');
  assert.doesNotMatch(client, /h-10 w-10 rounded-full bg-\[#ececec\]/, 'header must not render the dead avatar-shaped loading circle');
  assert.match(userMenu, /<UserAvatar initial=\{user\?\.avatarInitial\} size=\{40\}/, 'account avatar should use the shared black avatar with gradient ring');
  assert.match(userMenu, /creditBalance/, 'account menu should label the credit balance');
  assert.match(userMenu, /m\.nav\.myAlbums/, 'account menu should use the user-albums label');
  assert.match(userMenu, /`\/\$\{locale\}\/my-albums`/, 'account menu should link to the user albums');
  assert.match(userMenu, /`\/\$\{locale\}\/credits#history`/, 'account menu should link to credit consumption history');
  // 反馈从 mailto 死链改为应用内表单(POST /api/v1/feedback,落库+转发运营邮箱)。
  assert.match(userMenu, /setFeedbackOpen\(true\)/, 'account menu should open the in-app feedback form');
  assert.match(userMenu, /\/api\/v1\/feedback/, 'feedback form should post to the feedback API');
  assert.match(creditsPage, /id="history"/, 'credit consumption history link should have a stable page anchor');
  assert.match(enMessages, /"creditHistory": "Credit history"/, 'English menu should label consumption history');
  assert.match(zhMessages, /"creditHistory": "消耗记录"/, 'Chinese menu should use the requested consumption history label');
  assert.match(userMenu, /signOut/, 'account menu should keep logout available');
});

test('pricing best-value badge uses a colorful light background with purple text', () => {
  const client = component('YujeeLandingHomeClient.tsx');

  assert.match(client, /className="best-value-badge"/, 'best-value badge should use a dedicated visual class');
  assert.match(
    client,
    /\.best-value-badge \{[^}]*background: linear-gradient\(135deg, rgba\(140,94,244,\.16\), rgba\(19,184,166,\.12\) 58%, rgba\(218,244,94,\.18\)\);/s,
    'best-value badge should use the brand color wash instead of a black fill',
  );
  assert.match(client, /\.best-value-badge \{[^}]*color: #6b35d8;/s, 'best-value badge text should be purple');
  assert.doesNotMatch(
    client,
    /rounded-full bg-\[var\(--fg\)\][^"'`]*text-white[\s\S]{0,120}\{bestValue\}/,
    'best-value badge must not use the old black-background treatment',
  );
});

test('English landing moves the AI magazine line into the hero subtitle', () => {
  const client = component('YujeeLandingHomeClient.tsx');
  const movedLine = 'YUJEE AI turns your photos, stories, memories and ideas into a beautiful magazine made just for you.';

  assert.match(
    client,
    /heroSub:\s*'YUJEE AI turns your photos, stories, memories and ideas into a beautiful magazine made just for you\.'/,
    'the AI magazine line should be the English hero subtitle',
  );
  assert.doesNotMatch(
    client,
    /createSub:\s*'YUJEE AI turns your photos, stories, memories and ideas into a beautiful magazine made just for you\.'/,
    'the AI magazine line should no longer remain under the opening composer title',
  );
  assert.doesNotMatch(
    client,
    /You tell the story — the wording, layout and design are all on Yujee\./,
    'the replaced English hero subtitle should be removed',
  );
  assert.equal(client.split(movedLine).length - 1, 1, 'the moved English line should render from only one copy slot');
});

test('footer color accent is anchored to the page bottom on desktop and mobile', () => {
  const client = component('YujeeLandingHomeClient.tsx');
  const footerGlowRule = client.match(/\.footer-glow \{(?<rule>[^}]*)\}/s)?.groups?.rule ?? '';
  const desktopFooterGlowRule = client.match(/@media \(min-width: 768px\) \{ \.footer-glow \{(?<rule>[^}]*)\} \}/s)?.groups?.rule ?? '';

  assert.match(client, /\.landing-redesign \{[^}]*overflow-x: clip;/s, 'landing page should clip decorative horizontal blur overflow');
  assert.match(footerGlowRule, /bottom: 0;/, 'footer glow should be anchored to the bottom edge by default');
  assert.doesNotMatch(footerGlowRule, /bottom: -/, 'footer glow should not move below the footer on mobile');
  assert.match(footerGlowRule, /left: 0; right: 0;/, 'footer glow should not create horizontal overflow while fading upward');
  assert.match(desktopFooterGlowRule, /bottom: 0;/, 'desktop footer glow should keep the same bottom-origin behavior');
  assert.doesNotMatch(desktopFooterGlowRule, /bottom: -/, 'desktop footer glow should not be offset upward into the footer middle');
  assert.match(desktopFooterGlowRule, /left: 0; right: 0;/, 'desktop footer glow should not widen the page');
  assert.match(client, /<footer className="footer-section relative pb-10 pt-14">/, 'footer should let the bottom glow fade upward beyond its top edge');
  assert.match(client, /\.footer-section \{ overflow: visible; \}/, 'footer should not clip the upward footer glow fade');
  assert.doesNotMatch(client, /<footer className="relative overflow-hidden pb-10 pt-14">/, 'footer should not create a hard clipped gradient line');
  assert.match(
    footerGlowRule,
    /radial-gradient\(closest-side, rgba\(19,184,166,\.26\), transparent\) 12% 100%/s,
    'the left color bloom should originate from the bottom edge',
  );
  assert.match(
    footerGlowRule,
    /radial-gradient\(closest-side, rgba\(140,94,244,\.22\), transparent\) 52% 108%/s,
    'the center color bloom should originate just below the bottom edge',
  );
  assert.match(
    footerGlowRule,
    /radial-gradient\(closest-side, rgba\(218,244,94,\.28\), transparent\) 88% 100%/s,
    'the right color bloom should originate from the bottom edge',
  );
});

test('landing redesign uses local optimized assets from the supplied design folder', () => {
  const home = component('YujeeLandingHomeClient.tsx');
  for (const asset of landingAssets) {
    assert.match(home, new RegExp(asset.replaceAll('/', '\\/')), `${asset} should be referenced`);
    const file = join(webRoot, 'public', asset);
    assert.equal(existsSync(file), true, `${asset} should exist`);
    assert.ok(statSync(file).size < 500_000, `${asset} should be optimized for the homepage`);
  }
});

test('landing redesign keeps interactive surfaces client-side and accessible', () => {
  const client = component('YujeeLandingHomeClient.tsx');

  assert.match(client, /'use client'/, 'interactive shell should be client-side');
  assert.match(client, /setMobileOpen/, 'mobile menu should have an explicit open state');
  assert.match(client, /aria-expanded=\{mobileOpen\}/, 'mobile menu button should expose expanded state');
  assert.match(client, /setActivePreview/, 'book preview should support active chapter state');
  assert.match(client, /setInterval/, 'book preview should auto-advance like the supplied design');
  assert.match(client, /FAQItem/, 'FAQ should have a controlled accordion item');
  assert.match(client, /aria-expanded=\{open\}/, 'FAQ questions should expose expanded state');
  assert.match(client, /LandingPricing/, 'pricing buttons should keep the redesigned interactive pricing block');
  assert.match(client, /useSession/, 'pricing should still gate checkout through the real auth state');
});
