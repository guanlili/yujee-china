import type { Metadata } from 'next';
import { Bricolage_Grotesque } from 'next/font/google';
import '@/styles/globals.css';

// Display / heading typeface (DESIGN.md §3). Bound to --font-display; body stays
// system-ui (globals.css `body` rule) so this only loads where headings opt in.
const bricolageGrotesque = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-bricolage',
});

export const metadata: Metadata = {
  title: 'Yujee — Your AI Memoir',
  description: 'Turn your photos and stories into a printable keepsake magazine.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={bricolageGrotesque.variable}>
      <body>{children}</body>
    </html>
  );
}
