import type { Metadata } from 'next';
import '@/styles/globals.css';

// Display / heading typeface (DESIGN.md §3) was loaded via next/font/google
// (Bricolage Grotesque). That fetches from fonts.googleapis.com at compile time,
// which is unreachable behind the GFW and hangs every first compile. Disabled for
// local dev; --font-display in globals.css already falls back to system-ui.
// TODO: self-host the woff2 via next/font/local (download through a proxy) to
// restore the brand font without the network fetch.

export const metadata: Metadata = {
  title: 'Yujee — Your AI Memoir',
  description: 'Turn your photos and stories into a printable keepsake magazine.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
