'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import type { Locale } from '@/lib/i18n/routing';
import { getMessages } from '@/lib/i18n/messages';
import { Brand } from '@/components/app/Brand';
import { LanguageSwitcher } from '@/components/app/LanguageSwitcher';
import { UserMenu } from '@/components/app/UserMenu';
import { useChromeSession } from '@/components/app/useChromeSession';

export type SaveState = 'saved' | 'saving' | 'error';

interface Props {
  locale: Locale;
  title: string;
  saveState: SaveState;
  exporting: boolean;
  downloadUrl: string | null;
  onRename: (title: string) => void;
  onExport: () => void;
}

// Editor-specific solid topbar (design-v1 editor.html .topbar, v2 redesign).
// NOT the app-wide AppChrome (sidebar + blurred nav); it self-assembles from
// the UI-0 atoms (Brand / LanguageSwitcher / UserMenu) plus editor-only chrome:
// back button, contenteditable album title, autosave badge, and a brand-glow
// "Export PDF" button.
export function EditorTopbar({
  locale,
  title,
  saveState,
  exporting,
  downloadUrl,
  onRename,
  onExport,
}: Props) {
  const t = getMessages(locale).dashboard.editor;
  const session = useChromeSession();
  const titleRef = useRef<HTMLSpanElement>(null);

  // Keep the contenteditable text in sync when the title changes from elsewhere
  // (initial load, a rename that resolves) without clobbering the caret while
  // the user is actively typing in it.
  useEffect(() => {
    const el = titleRef.current;
    if (el && document.activeElement !== el && el.textContent !== title) {
      el.textContent = title;
    }
  }, [title]);

  const commit = () => {
    const next = (titleRef.current?.textContent ?? '').trim();
    if (next && next !== title) onRename(next);
    else if (titleRef.current) titleRef.current.textContent = title; // revert empty
  };

  return (
    <header className="flex h-[52px] flex-shrink-0 items-center justify-between border-b border-[var(--border-soft)] bg-[var(--surface)] px-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        <Link
          href={`/${locale}/my-albums`}
          title={t.backToProjects}
          aria-label={t.backToProjects}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--fg)]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <Brand href={`/${locale}`} className="flex-shrink-0" />
        <span className="hidden text-[var(--meta)] text-[var(--text-sm)] sm:inline">/</span>
        <span
          ref={titleRef}
          role="textbox"
          aria-label={t.titleAria}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLElement).blur();
            }
          }}
          className="max-w-[34vw] cursor-text truncate rounded-full border border-transparent px-2 py-1 font-display font-bold text-[var(--text-sm)] text-[var(--fg)] outline-none transition-colors hover:bg-[var(--bg)] focus:border-[var(--accent)] focus:bg-[var(--surface)] focus:shadow-[var(--focus-ring)]"
        />
        <span className="hidden items-center gap-1.5 rounded-full bg-[var(--bg)] px-2.5 py-1 font-mono text-[11px] tracking-[0.02em] text-[var(--muted)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] md:flex">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              saveState === 'error'
                ? 'bg-[#c44]'
                : saveState === 'saving'
                  ? 'animate-pulse bg-[var(--grad-lime)]'
                  : 'bg-[var(--grad-green)]'
            }`}
          />
          <span>{saveState === 'error' ? t.saveFailed : saveState === 'saving' ? t.saving : t.saved}</span>
        </span>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1 sm:gap-2">
        {/* Export PDF — brand-glow wrapper (design .btn-glow) behind a black pill */}
        <span className="yujee-export-glow relative inline-flex">
          <style>{`
            .yujee-export-glow::after{
              content:''; position:absolute; z-index:0; pointer-events:none;
              left:10%; right:10%; top:45%; bottom:-6px; border-radius:9999px;
              background:linear-gradient(90deg, var(--grad-green), var(--grad-purple), var(--grad-lime));
              filter:blur(13px); opacity:.55;
              transition:all var(--motion-base) var(--ease);
            }
            .yujee-export-glow:hover::after{ opacity:.78; filter:blur(17px); bottom:-9px; }
            .yujee-export-glow:has(button:disabled)::after{ opacity:0; }
            .yujee-export-glow > *{ position:relative; z-index:1; }
          `}</style>
          <button
            type="button"
            onClick={onExport}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-full bg-[var(--fg)] px-4 py-2.5 text-[var(--text-sm)] font-semibold text-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-transform hover:-translate-y-px disabled:translate-y-0 disabled:opacity-40 sm:px-7"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span className="hidden sm:inline">{exporting ? t.exporting : t.exportPdf}</span>
          </button>
        </span>
        {downloadUrl && (
          <a
            href={downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="hidden text-[var(--text-sm)] text-[var(--accent)] underline underline-offset-2 sm:inline"
          >
            {t.downloadPdf}
          </a>
        )}
        <LanguageSwitcher locale={locale} />
        <UserMenu user={session.user} locale={locale} />
      </div>
    </header>
  );
}
