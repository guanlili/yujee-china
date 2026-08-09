import {
  ADDON_PACKS,
  FREE_PLAN_CREDITS,
  PAGES_PER_CREDIT_LABEL,
  PHOTOS_PER_CREDIT,
} from '@/config/pricing';
import { LOCALE_LABELS, defaultLocale, locales, localizePath } from '@/lib/i18n/routing';
import { absoluteUrl } from '@/lib/seo/site';

/**
 * llms.txt body, generated rather than hand-written.
 *
 * The pricing block restates ADDON_PACKS and PHOTOS_PER_CREDIT, and the old
 * hand-written public/llms.txt silently went stale the first time the
 * photos-per-credit rule moved (10 → 20) — the constant changed, the file did
 * not, and the file is what AI crawlers read. Deriving it means that can't
 * happen again.
 *
 * Lives here, not in the route: a Next route file may only export GET/POST/
 * dynamic/etc, so a `buildLlmsTxt` export there fails typecheck.
 */
function pricingLines(): string[] {
  const packs = ADDON_PACKS.map(
    (pack) =>
      `- ${pack.books} credit${pack.books > 1 ? 's' : ''} — $${pack.priceUsd}`,
  );
  // State the rule, promise nothing. Lines like "charged only once the layout
  // succeeds" or "editing and export are free" describe today's implementation,
  // not a commitment — and public copy that outlives the implementation is a
  // liability. Keep this to what a credit buys.
  return [
    'No subscription. Credits are bought once and do not expire.',
    '',
    `- Sign-up includes ${FREE_PLAN_CREDITS} free credit${FREE_PLAN_CREDITS > 1 ? 's' : ''}`,
    ...packs,
    '',
    `1 credit = ${PHOTOS_PER_CREDIT} photo${PHOTOS_PER_CREDIT === 1 ? '' : 's'}. A book is usually ${PAGES_PER_CREDIT_LABEL} pages.`,
  ];
}

export function buildLlmsTxt(): string {
  return [
    '# Yujee',
    '',
    '> Yujee (遇己) turns a folder of personal photos into a magazine-style keepsake memoir. An AI groups the photos, writes the captions and chapter text, lays out the pages, and exports a 300 DPI print-ready PDF. The user edits by chatting with it rather than by dragging boxes around.',
    '',
    'Yujee is for people who have thousands of photos and nothing to show for them: a year in one book, a parent’s life story, a trip, a child’s growth record, a portfolio, or a magazine issue about your own life.',
    '',
    '## What makes it different',
    '',
    '- **It writes, not just arranges.** Most photo-book tools give you a layout grid and leave the words to you. Yujee drafts the captions, the chapter text and the pull quotes from your photos and notes.',
    '- **No manual placement.** You do not drag photos into slots one by one. The AI groups them by time, place and event, then lays out the spreads.',
    '- **You get a file, not a shipment.** The output is a 300 DPI print-ready PDF you own — print it anywhere, or keep it digital.',
    '- **Chat-based editing.** Every page stays editable, in conversation.',
    '',
    '## Pricing',
    '',
    ...pricingLines(),
    '',
    '## Privacy',
    '',
    'Original photos are never uploaded. Only compressed previews are sent to the AI for layout planning. Albums are private to their owner and are never made public.',
    '',
    '## Pages',
    '',
    `- [Home (${LOCALE_LABELS[defaultLocale]})](${absoluteUrl(localizePath('/', defaultLocale))}): the product, the six book types, pricing and FAQ`,
    // One line per translated home, derived from `locales` so a new language shows
    // up here the moment it is registered.
    ...locales
      .filter((locale) => locale !== defaultLocale)
      .map((locale) => `- [Home (${LOCALE_LABELS[locale]})](${absoluteUrl(localizePath('/', locale))}): same, in ${LOCALE_LABELS[locale]}`),
    `- [Privacy Policy](${absoluteUrl('/en/privacy')}): how photos and personal data are handled`,
    `- [Terms of Service](${absoluteUrl('/en/terms')})`,
    '',
    '## Contact',
    '',
    absoluteUrl('/'),
    '',
  ].join('\n');
}
