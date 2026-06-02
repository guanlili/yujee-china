'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Locale } from '@/lib/i18n/routing';

interface Props {
  locale: Locale;
  placeholder: string;
  uploadLabel: string;
  hints: { label: string; fill: string }[];
}

export function HeroComposer({ locale, placeholder, uploadLabel, hints }: Props) {
  const router = useRouter();
  const [value, setValue] = useState('');

  const go = () => router.push(`/${locale}/create`);

  return (
    <div
      className="relative z-[1] w-full max-w-[720px] rounded-2xl p-[2px] transition-shadow"
      style={{
        background: 'linear-gradient(135deg, var(--grad-green), var(--grad-purple), var(--grad-lime))',
        boxShadow:
          '0 0 20px rgba(23,225,135,0.15), 0 0 40px rgba(140,94,244,0.1), 0 0 60px rgba(218,244,94,0.08)',
      }}
    >
      <div className="rounded-2xl bg-[var(--surface)] p-5">
        <div className="flex items-start gap-3.5">
          <button
            type="button"
            onClick={go}
            aria-label={uploadLabel}
            title={uploadLabel}
            className="flex h-[78px] w-[52px] flex-shrink-0 -rotate-[15deg] items-center justify-center rounded-2xl bg-[var(--bg)] text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--fg)]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-[22px] w-[22px]">
              <line x1="12" y1="6" x2="12" y2="18" />
              <line x1="6" y1="12" x2="18" y2="12" />
            </svg>
          </button>
          <textarea
            rows={3}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                go();
              }
            }}
            placeholder={placeholder}
            className="min-h-[72px] flex-1 resize-none border-none bg-transparent text-[var(--text-base)] leading-relaxed text-[var(--fg)] outline-none placeholder:text-[var(--meta)]"
          />
        </div>
        <div className="mt-3.5 flex items-center justify-between gap-3">
          <div className="hidden flex-1 flex-wrap gap-1.5 sm:flex">
            {hints.map((hint) => (
              <button
                key={hint.label}
                type="button"
                onClick={() => setValue(hint.fill)}
                className="rounded-full bg-[var(--bg)] px-2.5 py-1 text-[var(--text-xs)] text-[var(--meta)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:bg-[var(--border-soft)] hover:text-[var(--fg-2)]"
              >
                {hint.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={go}
            aria-label="Start creating"
            className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-full bg-[var(--fg)] text-[var(--surface)] transition-transform hover:-translate-y-0.5"
            style={{
              boxShadow:
                '-6px 4px 8px -4px rgba(23,225,135,0.5), -3px 4px 8px -4px rgba(218,244,94,0.45), 0px 4px 8px -4px rgba(140,94,244,0.5), 3px 4px 8px -4px rgba(218,244,94,0.45), 6px 4px 8px -4px rgba(23,225,135,0.5)',
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
