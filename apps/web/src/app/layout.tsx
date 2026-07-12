import type { Metadata } from 'next';
import { getRequestLocale } from '@/lib/i18n/server-locale';
import { SITE_URL } from '@/lib/seo/site';
import '@/styles/globals.css';

// Display / heading typeface (DESIGN.md §3) was loaded via next/font/google
// (Bricolage Grotesque). That fetches from fonts.googleapis.com at compile time,
// which is unreachable behind the GFW and hangs every first compile. Disabled for
// local dev; --font-display in globals.css already falls back to system-ui.
// TODO: self-host the woff2 via next/font/local (download through a proxy) to
// restore the brand font without the network fetch.

export const metadata: Metadata = {
  // Resolves every relative canonical/OG URL against the apex rather than the
  // deployment host.
  metadataBase: new URL(SITE_URL),
  title: 'Yujee — Your AI Memoir',
  description: 'Turn your photos and stories into a printable keepsake magazine.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Was hardcoded to "en", so /zh declared itself English to every crawler and
  // screen reader.
  const locale = await getRequestLocale();

  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
