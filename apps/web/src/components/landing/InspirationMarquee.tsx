import Link from 'next/link';
import type { Locale } from '@/lib/i18n/routing';

interface Props {
  locale: Locale;
  title: string;
  more: string;
  cases: { title: string; desc: string }[];
}

// Soft brand-tinted cover fills so each card reads as a distinct keepsake
// rather than an empty gray box. Cycled by index.
const COVERS = [
  'linear-gradient(135deg, rgba(23,225,135,0.18), rgba(140,94,244,0.12))',
  'linear-gradient(135deg, rgba(218,244,94,0.22), rgba(23,225,135,0.12))',
  'linear-gradient(135deg, rgba(140,94,244,0.18), rgba(218,244,94,0.12))',
  'linear-gradient(135deg, rgba(23,225,135,0.14), rgba(218,244,94,0.18))',
  'linear-gradient(135deg, rgba(140,94,244,0.16), rgba(23,225,135,0.12))',
  'linear-gradient(135deg, rgba(218,244,94,0.18), rgba(140,94,244,0.14))',
];

export function InspirationMarquee({ locale, title, more, cases }: Props) {
  // Render the list twice so the -50% keyframe loops seamlessly. The second
  // copy is aria-hidden; keys carry the copy index since titles repeat.
  const track = [
    ...cases.map((c) => ({ ...c, copy: 0 })),
    ...cases.map((c) => ({ ...c, copy: 1 })),
  ];

  return (
    <section className="pb-24 md:pb-28">
      <div className="mb-12 flex items-end justify-between">
        <h2 className="text-2xl font-bold tracking-tight md:text-[32px]">{title}</h2>
        <Link
          href={`/${locale}/create`}
          className="group inline-flex items-center gap-1 text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
        >
          <span>{more}</span>
          <span className="transition-transform group-hover:translate-x-1">→</span>
        </Link>
      </div>

      <div className="-mx-6 overflow-hidden py-2 md:-mx-8">
        <div className="yujee-marquee flex w-max gap-5 px-6 md:px-8">
          {track.map((c, i) => (
            <Link
              key={`${c.copy}-${c.title}`}
              href={`/${locale}/create`}
              aria-hidden={c.copy === 1}
              tabIndex={c.copy === 1 ? -1 : undefined}
              className="group block w-[220px] flex-shrink-0"
            >
              <div
                className="mb-3.5 aspect-[3/4] overflow-hidden rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)] transition-shadow group-hover:shadow-[0_4px_12px_rgba(0,0,0,0.1),0_12px_32px_rgba(0,0,0,0.08)]"
                style={{ background: COVERS[i % COVERS.length] }}
              />
              <div className="text-base font-bold tracking-tight">{c.title}</div>
              <div className="mt-1 text-sm leading-snug text-[var(--muted)]">{c.desc}</div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
