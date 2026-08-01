import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const components = join(here, '..');
const webSrc = join(components, '..');

function component(path: string): string {
  return readFileSync(join(components, path), 'utf8');
}

function src(path: string): string {
  return readFileSync(join(webSrc, path), 'utf8');
}

test('marketing nav restores the Home 1 centered desktop menu and mobile menu', () => {
  const marketingNav = component('marketing/MarketingNav.tsx');
  const marketingMessages = src('messages/marketing.ts');

  assert.match(marketingMessages, /home: string/, 'marketing nav copy should expose home');
  assert.match(marketingMessages, /myProjects: string/, 'marketing nav copy should expose myProjects');
  assert.match(marketingMessages, /howItWorks: string/, 'marketing nav copy should expose howItWorks');
  assert.match(marketingMessages, /menuToggle: string/, 'mobile hamburger aria label should be localized');

  assert.match(marketingNav, /hidden md:flex/, 'desktop nav should be hidden until md');
  assert.match(
    marketingNav,
    /absolute left-1\/2 -translate-x-1\/2/,
    'desktop nav should stay centered independently from left and right clusters',
  );
  assert.match(marketingNav, /m\.nav\.home/, 'desktop/mobile nav should render Home copy');
  assert.match(marketingNav, /m\.nav\.myProjects/, 'desktop/mobile nav should render My Projects copy');
  assert.match(marketingNav, /m\.nav\.howItWorks/, 'desktop/mobile nav should render How it works copy');
  assert.match(marketingNav, /m\.nav\.pricing/, 'desktop/mobile nav should render Pricing copy');
  assert.match(
    marketingNav,
    /const homeSectionHref = \(id: string\) => \(isHome \? `#\$\{id\}` : `\$\{homePath\}#\$\{id\}`\)/,
    'section links should use Home 1 same-page hashes on home and localized landing hashes elsewhere',
  );
  // 'features', not 'how'. This assertion used to pin homeSectionHref('how'),
  // which froze a dead link in place: the landing renders id="features" and no
  // section has ever answered to #how, so the nav item did nothing on click.
  assert.match(
    marketingNav,
    /\{ key: 'how', label: m\.nav\.howItWorks, href: homeSectionHref\('features'\), active: false \}/,
    'How it works should point at the section id the landing actually renders',
  );
  assert.match(
    marketingNav,
    /\{ key: 'pricing', label: m\.nav\.pricing, href: homeSectionHref\('pricing'\), active: false \}/,
    'Pricing should route through the section href helper',
  );
  // About belongs in the footer, not the menu bar. The top nav is for the few
  // things a visitor came to do; a founder story is not one of them.
  assert.doesNotMatch(marketingNav, /about\/story/, 'About must not sit in the top nav');
  assert.match(marketingNav, /\/my-albums/, 'My Projects should point at the logged-in albums route');
  assert.match(marketingNav, /\buser\b/, 'My Projects should be gated by the same session state as chrome controls');
  assert.match(marketingNav, /md:hidden/, 'mobile nav should expose a hamburger/menu surface');
  assert.match(marketingNav, /aria-label=\{m\.nav\.menuToggle\}/, 'hamburger aria label should use marketing copy');
  assert.match(marketingNav, /aria-expanded=\{mobileOpen\}/, 'hamburger should declare expanded state');
  assert.match(marketingNav, /locales\.map/, 'mobile menu should include language choices');
});

test('HeroComposer stays embedded in the landing redesign shell and keeps send button details', () => {
  const heroComposer = component('landing/HeroComposer.tsx');
  const landingClient = component('landing/YujeeLandingHomeClient.tsx');
  const composerShellClass = landingClient.match(/<div className="composer-shell ([^"]+)">/)?.[1] ?? '';

  // The landing renders its OWN footer, so the story link added to
  // MarketingFooter is invisible on the one page most visitors ever see. It
  // belongs in the footer and nowhere else: exactly one occurrence, and not in
  // the header pill or the mobile menu sheet.
  assert.equal(
    (landingClient.match(/about\/story/g) ?? []).length,
    1,
    'landing should link the story exactly once, from the footer',
  );
  assert.match(
    landingClient,
    /\[c\.footerStory, `\/\$\{locale\}\/about\/story`\]/,
    'the story should be a footer column entry',
  );
  assert.match(landingClient, /footerCompany: '关于'/, 'the footer column should be titled 关于');
  assert.match(landingClient, /footerCompany: 'About'/, 'the footer column should be titled About');

  assert.match(landingClient, /\{composer\}/, 'redesigned landing shell should render the real composer');
  assert.match(composerShellClass, /px-5/, 'composer shell should keep mobile horizontal padding');
  assert.match(composerShellClass, /md:px-8/, 'composer shell should scale horizontal padding on desktop');
  assert.match(composerShellClass, /max-w-2xl/, 'composer shell should keep the redesigned centered width');

  assert.match(heroComposer, /rounded-\[22px\]/, 'outer gradient border should use a 22px radius');
  assert.match(heroComposer, /text-left/, 'composer should restore Home 1 left text alignment');
  assert.match(
    heroComposer,
    /focus-within:shadow-\[0_0_0_4px_rgba\(19,184,166,0\.18\)\]/,
    'outer gradient border should get the Home 1 focus ring',
  );
  assert.match(heroComposer, /rounded-\[20px\]/, 'inner card should use a 20px radius');
  assert.match(heroComposer, /p-4 sm:p-5/, 'inner card padding should scale at sm');
  assert.match(heroComposer, /gap-3 sm:gap-4/, 'composer body gap should scale at sm');
  assert.match(heroComposer, /rows=\{2\}/, 'textarea should use two visible rows');
  assert.match(heroComposer, /rounded-lg/, 'upload card should use Home 1 rounded-lg corners');

  assert.doesNotMatch(heroComposer, /boxShadow/, 'send button glow must not use inline box-shadow');
  assert.match(heroComposer, /btn-glow/, 'send button should use the Home 1 glow wrapper');
  assert.match(heroComposer, /#homepage-composer \.btn-glow/, 'btn-glow CSS should be scoped to the composer');
  assert.match(heroComposer, /btn-glow-disabled/, 'disabled send button should not receive hover glow intensification');
  assert.match(heroComposer, /const submit = async \(\) => \{\s*if \(busy\) return;/s, 'submit should no-op while photos are still processing');
  assert.match(heroComposer, /if \(busy\) return;\s*void submit\(\);/s, 'Enter-to-submit should be disabled while photos are still processing');
  assert.match(heroComposer, /linear-gradient\(90deg,\s*var\(--grad-green\),\s*var\(--grad-purple\),\s*var\(--grad-lime\)\)/);
  assert.match(heroComposer, /h-10 w-10/, 'send button should be 40px');
  assert.doesNotMatch(heroComposer, /h-\[42px\]|w-\[42px\]/, 'send button should not keep the old 42px size');
  assert.match(heroComposer, /<line x1="12" y1="19" x2="12" y2="5" \/>/, 'send arrow should point upward');
  assert.match(heroComposer, /<polyline points="5 12 12 5 19 12" \/>/, 'send arrow should use the upward arrow head');
});
