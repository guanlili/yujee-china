import type { AT } from '@/lib/i18n/pick';
import type { Spread } from './spreads';

/**
 * The end-of-book prompt on the public share page.
 *
 * The share page is the only place a stranger ever meets a finished Yujee book,
 * and it is the most persuaded they will ever be — they just read someone's
 * memoir end to end. Until now the page dead-ended: no branding, no way back.
 *
 * It stays `noindex` (these are private memoirs, and that is the right call), so
 * this loop is worth exactly nothing to search rankings. It is referral traffic
 * from real people, which is the half of "backlinks" that pays off immediately.
 */

/**
 * Whether the reader is looking at the closing spread.
 *
 * Not `selected === pages.length - 1`: interior pages pair two-up, so a book
 * without a dedicated ending page finishes on a pair, and a reader parked on its
 * left half has still reached the end. Ask the spread, not the index.
 */
export function isLastSpread(spreads: Spread[], selectedPageIndex: number): boolean {
  if (!spreads.length) return false;
  const current = spreads.findIndex((s) =>
    s.kind === 'full'
      ? s.page === selectedPageIndex
      : s.left === selectedPageIndex || s.right === selectedPageIndex,
  );
  return current !== -1 && current === spreads.length - 1;
}

export interface ShareCtaCopy {
  title: string;
  body: string;
  primary: string;
  secondary: string;
  copied: string;
  dismiss: string;
}

/**
 * Resolved through the app's zh/en pair + overlay pipeline rather than a private
 * two-locale table: the site ships five locales, and a table keyed 'en' | 'zh'
 * would hand Chinese to every Spanish, Japanese and French reader.
 *
 * No price, no credits, no "sign up". Someone who just closed a stranger's
 * memoir is the worst audience alive for a price tag — the ask is "make one",
 * and guest mode means that is literally true before any account exists.
 */
export function shareCta(aT: AT): ShareCtaCopy {
  return {
    title: aT('想要一本同款吗？', 'Want a book like this?'),
    body: aT(
      '上传照片，Yujee 的 AI 几分钟排好一整本。可以先免费做。',
      'Upload your photos and Yujee’s AI lays out a whole photo book in minutes. Free to start.',
    ),
    primary: aT('做一本我的', 'Make mine'),
    secondary: aT('分享这本书', 'Share this book'),
    copied: aT('链接已复制', 'Link copied'),
    dismiss: aT('继续看', 'Keep reading'),
  };
}
