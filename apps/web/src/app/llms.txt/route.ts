import { buildLlmsTxt } from '@/lib/seo/llms';

/**
 * Lives at app/ root for the same reason robots.ts does: under app/[locale]/ the
 * path would be parsed as locale="llms.txt" and 404.
 *
 * The body is built in lib/seo/llms.ts — a Next route file may only export
 * GET/POST/dynamic/etc, so the builder cannot be exported from here.
 */
export const dynamic = 'force-static';

export function GET(): Response {
  return new Response(buildLlmsTxt(), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
