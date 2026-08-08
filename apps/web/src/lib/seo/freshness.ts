import { EXAMPLE_SLUGS } from '@/lib/examples/examples';

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
 * TWO DATES, ON PURPOSE — do not collapse them:
 *
 *   updatedAt  — the day this page's prose actually moved. It goes to Google.
 *                Bump it ONLY when a reader would see something different.
 *   reviewedAt — the commit at which a human last confirmed `updatedAt` is
 *                still correct. Bump it freely; it never reaches Google.
 *
 * The split matters because `sources` are shared: messages/marketing.ts backs
 * the landing AND the legal pages. Editing landing copy touches that file, so
 * the checker will flag /privacy too — and the right answer there is "looked,
 * the privacy prose did not change" (bump reviewedAt, leave updatedAt). Using
 * one field would force you to tell Google the privacy policy changed every
 * time you reworded the homepage.
 *
 * `scripts/sitemap-freshness-check.mjs` enforces this and runs inside
 * `pnpm typecheck`. It fails when a route's `sources` picked up commits after
 * its `reviewedAt`, so the judgement call gets made instead of skipped.
 */
export interface RouteFreshness {
  /** Files whose content this page renders. A change here needs a decision. */
  sources: readonly string[];
  /** YYYY-MM-DD. The day the visible content last changed. Emitted as lastmod. */
  updatedAt: string;
  /** Commit at which `updatedAt` was last confirmed correct. Never published. */
  reviewedAt: string;
}

// 五语拆分后营销/示例文案按语言一文件放在目录里;目录整个作 pathspec,
// 任何语言的译文改动都会把对应路由拽进这道闸门。
const MARKETING = 'apps/web/src/messages/marketing';
const EXAMPLES = ['apps/web/src/lib/examples/examples.ts', 'apps/web/src/lib/examples/content'] as const;

/** Every example detail page is one row of the same array, so they share sources. */
const exampleDetailFreshness: Record<string, RouteFreshness> = Object.fromEntries(
  EXAMPLE_SLUGS.map((slug) => [
    `/examples/${slug}`,
    { sources: [...EXAMPLES], updatedAt: '2026-08-08', reviewedAt: '0a7e4291' },
  ]),
);

export const ROUTE_FRESHNESS: Record<string, RouteFreshness> = {
  '/': {
    sources: [MARKETING, 'apps/web/src/components/landing/copy', 'apps/web/src/components/landing/YujeeLandingHome.tsx', 'apps/web/src/components/landing/YujeeLandingHomeClient.tsx', 'apps/web/src/lib/seo/faq'],
    updatedAt: '2026-08-08',
    reviewedAt: '0a7e4291',
  },
  '/about/story': {
    sources: [MARKETING, 'apps/web/src/app/[locale]/about/story/page.tsx'],
    updatedAt: '2026-08-01',
    reviewedAt: '0a7e4291',
  },
  // Privacy prose last moved in the pre-launch pass that aligned it with what the
  // product actually does (b69eb438). marketing.ts has moved several times since —
  // including b3d095bc, which rewrote the TERMS sections next door and left this
  // page untouched. That is exactly the case the reviewedAt/updatedAt split exists
  // for: reviewed again, still 2026-07-12.
  '/privacy': { sources: [MARKETING], updatedAt: '2026-07-12', reviewedAt: '0a7e4291' },
  // b3d095bc rewrote sections 5–12 (breach/termination, governing law, the real
  // refund rule) in both locales — a genuine content change, so this one moves.
  '/terms': { sources: [MARKETING], updatedAt: '2026-08-08', reviewedAt: '0a7e4291' },
  // The hub renders each example's `title`, not its meta — the keyword pass
  // rewrote titles/descriptions on the detail pages only, so the hub is unchanged.
  '/examples': { sources: [...EXAMPLES, MARKETING], updatedAt: '2026-08-04', reviewedAt: '0a7e4291' },
  ...exampleDetailFreshness,
};

/** The `<lastmod>` for a route, as a plain date string — never a Date, whose
 *  serialisation would shift the day across timezones. */
export function contentUpdatedAt(route: string): string | undefined {
  return ROUTE_FRESHNESS[route]?.updatedAt;
}
