import { SOCIAL_LINKS } from '@/config/social';

// Renders only the accounts that actually exist. This used to ship five icons
// (Discord/Instagram/YouTube/TikTok/X) all pointing at href="#", plus a Weibo
// icon on the landing footer pointing at weibo.com's homepage — every one of them
// dead on click, which reads worse than having no icons at all. An entry with no
// href renders nothing; see @/config/social.
export function MarketingSocials() {
  const live = SOCIAL_LINKS.filter((s) => s.href);
  if (live.length === 0) return null;

  return (
    <div className="flex gap-3 mt-5">
      {live.map((s) => (
        <a
          key={s.label}
          href={s.href}
          target="_blank"
          rel="noreferrer"
          aria-label={s.label}
          className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--meta)] hover:text-[var(--fg)] hover:bg-black/[0.04] transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
            <path d={s.path} />
          </svg>
        </a>
      ))}
    </div>
  );
}
