// Native <details>/<summary> accordion. No JS needed — open state is the
// browser's; the +/− toggle is pure CSS driven by the [open] attribute. Scoped
// <style> here (does not touch globals.css). Icons are Lucide line strokes.

interface Props {
  title: string;
  items: { q: string; a: string }[];
}

export function FaqList({ title, items }: Props) {
  return (
    <section className="px-5 py-12 sm:px-8 sm:py-16">
      <style>{`
        .yj-faq { border-bottom: 1px solid var(--border-soft); }
        .yj-faq > summary { list-style: none; }
        .yj-faq > summary::-webkit-details-marker { display: none; }
        .yj-faq .yj-faq-ico { transition: transform .2s ease; }
        .yj-faq[open] .yj-faq-ico { transform: rotate(45deg); }
      `}</style>

      <div className="mx-auto max-w-[720px]">
        <h2
          className="mb-6 text-center text-[clamp(22px,3.4vw,30px)] font-extrabold leading-[1.25] tracking-[-0.02em]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {title}
        </h2>

        {items.map((item) => (
          <details key={item.q} className="yj-faq">
            <summary className="flex cursor-pointer items-center justify-between gap-4 py-[18px] text-[15px] font-semibold text-[var(--fg)]">
              <span>{item.q}</span>
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="yj-faq-ico h-4 w-4 shrink-0 text-[var(--muted)]"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </summary>
            <p className="max-w-[60ch] pb-[18px] text-sm leading-[1.7] text-[var(--muted)]">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
