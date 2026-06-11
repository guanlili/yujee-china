'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import type { Locale } from '@/lib/i18n/routing';
import { getMessages } from '@/lib/i18n/messages';
import { Brand } from '@/components/app/Brand';
import { ChromeStatusBar } from '@/components/app/ChromeStatusBar';

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

// Editor-specific solid topbar (design-v1 editor.html .topbar). It is NOT the
// app-wide AppChrome (sidebar + blurred nav); it self-assembles from the UI-0
// atoms (Brand / LanguageSwitcher / UserMenu) plus editor-only
// chrome: back button, contenteditable title, autosave badge, export button.
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
    <header className="flex h-[52px] flex-shrink-0 items-center justify-between border-b border-[var(--border-soft)] bg-[var(--surface)] px-6">
      <div className="flex min-w-0 items-center gap-4">
        <Link
          href={`/${locale}/my-albums`}
          title={t.backToProjects}
          aria-label={t.backToProjects}
          className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--fg)]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <Brand href={`/${locale}`} />
        <span className="text-[var(--meta)] text-[var(--text-sm)]">/</span>
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
          className="max-w-[40vw] cursor-text truncate rounded-full border border-transparent px-2 py-1 font-bold text-[var(--text-sm)] text-[var(--fg)] outline-none transition-colors hover:bg-[var(--bg)] focus:border-[var(--accent)] focus:bg-[var(--surface)] focus:shadow-[var(--focus-ring)]"
        />
        <span className="flex items-center gap-1.5 rounded-full bg-[var(--bg)] px-2.5 py-1 text-[var(--text-xs)] text-[var(--muted)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
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

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          className="flex items-center gap-1.5 rounded-full bg-[var(--fg)] px-6 py-2.5 text-[var(--text-sm)] font-semibold text-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-all hover:-translate-y-px hover:bg-[var(--fg-2)] disabled:translate-y-0 disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>{exporting ? t.exporting : t.exportPdf}</span>
        </button>
        {downloadUrl && (
          <a
            href={downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--text-sm)] text-[var(--accent)] underline underline-offset-2"
          >
            {t.downloadPdf}
          </a>
        )}
        <span className="mx-1 h-5 w-px bg-[var(--border-soft)]" />
        <ChromeStatusBar locale={locale} />
      </div>
    </header>
  );
}
