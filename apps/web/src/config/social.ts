/**
 * The site's social accounts — the ONE place they are declared.
 *
 * `href: ''` means "no account yet": the icon is not rendered at all. Never put a
 * placeholder URL here. The footer used to ship five icons pointing at "#" and a
 * Weibo icon pointing at weibo.com's homepage; every one was dead on click, which
 * costs more trust than showing nothing.
 *
 * Add an account by filling in its href. Add a new network by appending an entry
 * with its brand path (24×24 viewBox).
 */
export interface SocialLink {
  label: string;
  /** Full profile URL. Empty string = account does not exist yet = not rendered. */
  href: string;
  /** SVG path data, 24×24 viewBox. */
  path: string;
}

/** Support inbox shown in the footer. The privacy/deletion inbox is separate. */
export const SUPPORT_EMAIL = 'support@yujeeai.com';

export const SOCIAL_LINKS: readonly SocialLink[] = [
  {
    label: 'X',
    href: '',
    path: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
  },
] as const;
