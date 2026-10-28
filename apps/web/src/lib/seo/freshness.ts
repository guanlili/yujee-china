import { EXAMPLES } from '@/lib/examples/examples';
import { GUIDES, getGuide } from '@/lib/guides/guides';

/**
 * When each indexable page's CONTENT last actually changed.
 *
 * This is the `<lastmod>` in the sitemap, and it is the only recrawl signal
 * Google still honours — `changefreq` and `priority` are documented as ignored.
 * It earns that trust only by being true: a lastmod derived from the build
 * clock says "everything changed" on every deploy, Google notices it is never
 * right, and then discounts the field for the whole site. A wrong signal is
 * worse than no signal, which is why the sitemap shipped without one until now.
 *
 * TWO FIELDS, ON PURPOSE — do not collapse them:
 *
 *   updatedAt        — the day this page's prose actually moved. It goes to Google.
 *                      Bump it ONLY when a reader would see something different.
 *   reviewedSources  — 12-hex content fingerprint of `sources` at HEAD when a
 *                      human last confirmed `updatedAt` is still correct.
 *                      Bump it freely; it never reaches Google. Computed as
 *                      sha256(git ls-tree -r HEAD -- <sources>).hex[:12] — see
 *                      `pnpm --filter @yujee/web sitemap:stamp`.
 *
 * The split matters because `sources` are shared: messages/marketing backs
 * the landing AND the legal pages. Editing landing copy touches that tree, so
 * the checker will flag /privacy too — and the right answer there is "looked,
 * the privacy prose did not change" (bump reviewedSources, leave updatedAt).
 * Using one field would force you to tell Google the privacy policy changed
 * every time you reworded the homepage.
 *
 * Why a fingerprint and not a commit SHA: squash-merge drops PR tip SHAs, so a
 * reviewedAt tip-SHA either fails rev-parse on main or forces a follow-up "刷
 * SHA" PR (#58→#59). The fingerprint binds the source *tree*, which survives
 * squash / rebase / merge-commit unchanged.
 *
 * `scripts/sitemap-freshness-check.ts` enforces this and runs inside
 * `pnpm typecheck`. It fails when a route's sources fingerprint at HEAD does
 * not match `reviewedSources`, so the judgement call gets made instead of skipped.
 */
export interface RouteFreshness {
  /** Files whose content this page renders. A change here needs a decision. */
  sources: readonly string[];
  /** YYYY-MM-DD. The day the visible content last changed. Emitted as lastmod. */
  updatedAt: string;
  /**
   * 12-hex content fingerprint of `sources` when `updatedAt` was last confirmed.
   * Never published. Not a commit SHA — squash-safe.
   */
  reviewedSources: string;
}

// 五语拆分后营销/示例文案按语言一文件放在目录里;目录整个作 pathspec,
// 任何语言的译文改动都会把对应路由拽进这道闸门。
const MARKETING = 'apps/web/src/messages/marketing';
const EXAMPLE_SOURCES = ['apps/web/src/lib/examples/examples.ts', 'apps/web/src/lib/examples/content'] as const;
/**
 * One fingerprint for every /examples row. Each example carries its own `updatedAt`
 * (the day its page last changed) but they share sources, so a single stamp
 * covers them all — same shape as GUIDES_HUB_REVIEWED_SOURCES.
 */
const EXAMPLES_REVIEWED_SOURCES = '2d037cc766bf';
/** Hub also reads marketing chrome, so its fingerprint differs from detail rows. */
const EXAMPLES_HUB_REVIEWED_SOURCES = '408ca3fb74bc';
/** Guide prose only. guides.ts is excluded on purpose — see FRESHNESS_DECLARATIONS. */
const GUIDES_CONTENT = 'apps/web/src/lib/guides/content';
/** The hub has no article of its own to carry a reviewedSources, so it lives here. */
const GUIDES_HUB_REVIEWED_SOURCES = '837a8668b7ec';

/**
 * Every example detail page is one row of the same array, so they share sources.
 * The date comes from the example itself: the two 2026-07 formats last moved in
 * the 2026-08-08 keyword pass; the four added on 2026-09-21 carry that day.
 * Giving all six one date would tell Google the old pages changed when they
 * did not — the exact lie this file exists to prevent.
 */
const exampleDetailFreshness: Record<string, RouteFreshness> = Object.fromEntries(
  EXAMPLES.map((example) => [
    `/examples/${example.slug}`,
    { sources: [...EXAMPLE_SOURCES], updatedAt: example.updatedAt, reviewedSources: EXAMPLES_REVIEWED_SOURCES },
  ]),
);

export const ROUTE_FRESHNESS: Record<string, RouteFreshness> = {
  // 首页读者可见的改动,按时间:74c590db(09-09,H1/eyebrow 吃进投放词)、
  // e9ec66fe(页脚 travel 锚文本改成该页的词)、d2bca297(09-11,桌面导航/移动
  // 菜单/页脚三处多出 Guides)。注意 c4148143 把「页脚 Pricing 改指 /pricing」
  // 只落在共用 MarketingFooter 上,首页渲染的是自己的页脚,当时并没有变 ——
  // 上一版这里把它记成首页改动,是错的。
  // 2026-09-21:首屏 composer 下面加了六本样书条,样书卡的「查看示例」改指
  // /examples/<slug>,首页自己的页脚 Pricing 也终于指向 /pricing。首屏多出
  // 一整排图,读者看得见,updatedAt 落在这天。
  // 2026-10-28: landing + shared footers show MIIT ICP filing link (reader-visible chrome).
  '/': {
    sources: [MARKETING, 'apps/web/src/components/landing/copy', 'apps/web/src/components/landing/YujeeLandingHome.tsx', 'apps/web/src/components/landing/YujeeLandingHomeClient.tsx', 'apps/web/src/lib/seo/faq'],
    updatedAt: '2026-10-28',
    reviewedSources: 'dbd0fb078981',
  },
  // bd254fcd rewrote the「一个人做的」section in all five locales: dropped the
  // Claude Code attribution, added the rough-edges admission, added a feedback
  // paragraph. Reader-visible prose, so this one moves.
  '/about/story': {
    sources: [MARKETING, 'apps/web/src/app/[locale]/about/story/page.tsx'],
    updatedAt: '2026-08-10',
    reviewedSources: '79dfadf380e6',
  },
  // Privacy prose last moved in the pre-launch pass that aligned it with what the
  // product actually does (b69eb438). marketing.ts has moved several times since —
  // including b3d095bc, which rewrote the TERMS sections next door and left this
  // page untouched. That is exactly the case the reviewedSources/updatedAt split exists
  // for: reviewed again, still 2026-07-12.
  // config/pricing.ts is a source because a repricing IS a content change here:
  // every figure on the page is interpolated from ADDON_PACKS and the credit
  // constants, so editing them changes what the reader sees without touching a
  // single string of copy.
  // 3fb63bbc (2026-09-21) 把每张单价从 "$0.1" 修成 "$0.10"。改的是一个数字的
  // 写法,但读者看到的字符确实变了,按契约 updatedAt 要动;定价页被重抓一次
  // 也没有坏处。
  '/pricing': {
    sources: [MARKETING, 'apps/web/src/config/pricing.ts', 'apps/web/src/app/[locale]/pricing/page.tsx'],
    updatedAt: '2026-09-21',
    reviewedSources: '4c116eefa4e1',
  },
  // messages/marketing 这轮被 74c590db(首页 en meta)、d2bca297(共用导航多一项
  // Guides)、c4148143(共用页脚 Pricing 改指 /pricing)和 2026-09-21 的
  // examples.moreComing 一行碰到。对隐私页而言全是 chrome 或别页的文案,正文
  // 一个字没动 —— 这正是 reviewedSources/updatedAt 分开的意义:只推 reviewedSources。
  // 刷 updatedAt 等于告诉 Google 隐私政策也改了。
  '/privacy': { sources: [MARKETING], updatedAt: '2026-10-28', reviewedSources: 'cfa69fff4fa2' },
  // b3d095bc rewrote sections 5–12 (breach/termination, governing law, the real
  // refund rule) in both locales — a genuine content change, so this one moves.
  '/terms': { sources: [MARKETING], updatedAt: '2026-10-28', reviewedSources: 'cfa69fff4fa2' },
  // reviewedSources 是内容指纹,不是 commit SHA —— squash/rebase 后不必重刷。
  // The hub renders one card per example, so it changes whenever the newest
  // example does — derived, like the guides hub, instead of hand-dated.
  '/examples': {
    sources: [...EXAMPLE_SOURCES, MARKETING],
    updatedAt: EXAMPLES.map((e) => e.updatedAt).sort().at(-1) ?? '',
    reviewedSources: EXAMPLES_HUB_REVIEWED_SOURCES,
  },
  ...exampleDetailFreshness,
};

/**
 * Every indexable route's freshness declaration, hand-kept rows and guides
 * alike. `scripts/sitemap-freshness-check.ts` iterates THIS, not
 * ROUTE_FRESHNESS — a route missing here has a lastmod nothing verifies.
 *
 * Guides opt out of the hand-kept map above but not out of the gate. The two
 * are different questions and conflating them left guides unguarded once
 * already: the script reported "7 routes" while the sitemap carried 9, which
 * reads as full coverage and is not.
 *
 * A guide's `sources` is the content directory only, deliberately excluding
 * guides.ts — that file holds `updatedAt` itself, so including it would make
 * every date bump trip its own gate (the same reason the script excludes this
 * file from its own pathspecs).
 */
export const FRESHNESS_DECLARATIONS: Record<string, RouteFreshness> = {
  ...ROUTE_FRESHNESS,
  '/guides': {
    // The hub renders each article's title and excerpt, plus its own chrome
    // from the marketing messages — so both can change what a reader sees.
    sources: [GUIDES_CONTENT, MARKETING],
    updatedAt: GUIDES.map((g) => g.updatedAt).sort().at(-1) ?? '',
    reviewedSources: GUIDES_HUB_REVIEWED_SOURCES,
  },
  ...Object.fromEntries(
    GUIDES.map((guide) => [
      `/guides/${guide.slug}`,
      { sources: [GUIDES_CONTENT], updatedAt: guide.updatedAt, reviewedSources: guide.reviewedSources },
    ]),
  ),
};

/**
 * Guides are deliberately NOT rows in ROUTE_FRESHNESS.
 *
 * That map exists to arbitrate SHARED sources: messages/marketing.ts backs the
 * landing and the legal pages at once, so "did this page's prose change" needs a
 * human to answer. A guide owns exactly one content entry, so the question has a
 * mechanical answer and the date lives on the article itself — editing one guide
 * can never implicate another, and adding an article does not mean remembering
 * to add a row here.
 *
 * The hub is the newest article's date because it renders their titles and
 * excerpts: it genuinely changes whenever the newest one does.
 */
function guideUpdatedAt(route: string): string | undefined {
  if (route === '/guides') return GUIDES.map((g) => g.updatedAt).sort().at(-1);
  const slug = route.startsWith('/guides/') ? route.slice('/guides/'.length) : undefined;
  return slug ? getGuide(slug)?.updatedAt : undefined;
}

/** The `<lastmod>` for a route, as a plain date string — never a Date, whose
 *  serialisation would shift the day across timezones. */
export function contentUpdatedAt(route: string): string | undefined {
  return guideUpdatedAt(route) ?? ROUTE_FRESHNESS[route]?.updatedAt;
}
