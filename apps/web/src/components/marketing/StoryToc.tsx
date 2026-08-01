'use client';

import { useEffect, useState } from 'react';

interface Props {
  head: string;
  /** Section ids in document order, paired with their heading text. */
  items: { id: string; label: string }[];
  /**
   * `rail` is the sticky desktop column; `inline` is the collapsed mobile block.
   *
   * They are rendered as two separate instances in two different places rather
   * than one component that switches at a breakpoint, because document order
   * differs: the rail is a grid column to the left of everything, while the
   * inline block has to sit *after* the title. One instance holding both would
   * put a table of contents above the headline on a phone.
   */
  variant: 'rail' | 'inline';
}

/**
 * The story page's contents rail.
 *
 * Sticky on desktop and left of the prose, so a reader can see where they are in
 * a long first-person piece without scrolling back up. The active item is driven
 * by IntersectionObserver rather than a scroll handler: a scroll listener fires
 * on every frame and would have to measure offsets itself, which thrashes layout
 * on exactly the long page this exists for.
 *
 * `rootMargin` pins the detection band near the top of the viewport. Without it
 * the observer reports whichever section covers the most pixels, so a short
 * section never wins and the rail lies about where the reader is.
 *
 * On mobile the rail collapses into a native <details>: no drawer state, no
 * focus trap, and it still works before hydration.
 */
export function StoryToc({ head, items, variant }: Props) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? '');

  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-96px 0px -70% 0px', threshold: 0 },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [items]);

  const list = (
    <ol className="space-y-1">
      {items.map((item, i) => {
        const active = item.id === activeId;
        return (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={active ? 'true' : undefined}
              className={`flex gap-2.5 rounded-md py-1.5 pl-2.5 pr-2 text-[13px] leading-snug transition-colors ${
                active
                  ? 'bg-black/[0.04] font-medium text-[var(--fg)]'
                  : 'text-[var(--meta)] hover:text-[var(--fg-2)]'
              }`}
            >
              <span className="w-3 shrink-0 tabular-nums">{i + 1}</span>
              <span>{item.label}</span>
            </a>
          </li>
        );
      })}
    </ol>
  );

  if (variant === 'inline') {
    return (
      <details className="mb-12 rounded-2xl bg-[var(--bg)] px-4 py-3 lg:hidden">
        <summary className="cursor-pointer list-none text-[13px] font-semibold uppercase tracking-[0.14em] text-[var(--meta)]">
          {head}
        </summary>
        <div className="pt-3">{list}</div>
      </details>
    );
  }

  return (
    <nav aria-label={head} className="hidden lg:block">
      <div className="sticky top-24">
        <p className="mb-3 pl-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--meta)]">
          {head}
        </p>
        {list}
      </div>
    </nav>
  );
}
