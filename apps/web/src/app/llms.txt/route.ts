import { ADDON_PACKS, FREE_PLAN_CREDITS, PHOTOS_PER_CREDIT } from '@/config/pricing';
import { absoluteUrl } from '@/lib/seo/site';

/**
 * Generated, not static. The pricing block here restates ADDON_PACKS and
 * PHOTOS_PER_CREDIT, and a hand-written public/llms.txt silently went stale the
 * first time the photos-per-credit rule moved (10 → 20) — the constant changed,
 * the file did not. Deriving it means that can't happen again.
 *
 * Lives at app/ root for the same reason robots.ts does: under app/[locale]/ the
 * path would be parsed as locale="llms.txt" and 404.
 */
export const dynamic = 'force-static';

function pricingLines(): string[] {
  const packs = ADDON_PACKS.map(
    (pack) =>
      `- ${pack.books} credit${pack.books === 1 ? '' : 's'} — $${pack.priceUsd}`,
  );
  return [
    'No subscription. Credits are bought once and do not expire.',
    '',
    `- Sign-up includes ${FREE_PLAN_CREDITS} free credit (enough for a book of up to ${PHOTOS_PER_CREDIT} photos)`,
    ...packs,
    '',
    `One credit covers up to ${PHOTOS_PER_CREDIT} photos in a generated book. A book of N photos costs ceil(N / ${PHOTOS_PER_CREDIT}) credits, charged when the layout succeeds.`,
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
    `- [Home (English)](${absoluteUrl('/en')}): the product, the six book types, pricing and FAQ`,
    `- [Home (中文)](${absoluteUrl('/zh')}): same, in Chinese`,
    `- [Privacy Policy](${absoluteUrl('/en/privacy')}): how photos and personal data are handled`,
    `- [Terms of Service](${absoluteUrl('/en/terms')})`,
    '',
    '## Contact',
    '',
    absoluteUrl('/'),
    '',
  ].join('\n');
}

export function GET(): Response {
  return new Response(buildLlmsTxt(), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
