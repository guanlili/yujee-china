'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FlipBook } from './FlipBook';
import { isLastSpread, shareCta } from './shared-album-cta';
import { buildSpreads } from './spreads';
import type { ResolveImage } from './adapt-layout';
import type { EditorPage } from './types';
import { presetImageUrl } from '@/lib/board-bg/presets';
import { boundPick } from '@/lib/i18n/pick';
import { defaultLocale, isLocale } from '@/lib/i18n/routing';

export type SharedBoardBackground =
  | { kind: 'color'; color: string }
  | { kind: 'preset'; presetId: string }
  | { kind: 'upload'; key: string }
  | null;

// 免登只读分享视图:复用编辑器的 FlipBook 翻书;不传 onEditPage => 铅笔按钮不渲染,纯只读。
// 图片走冻结的公开快照 URL(photoUrls),不碰本地 IndexedDB —— 别人浏览器也能看。
export function SharedAlbum({
  pages,
  photoUrls,
  boardBackground,
  locale,
  title,
}: {
  pages: EditorPage[];
  photoUrls: Record<string, string>;
  boardBackground: SharedBoardBackground;
  locale: string;
  title: string;
}) {
  const [selected, setSelected] = useState(0);
  const resolveImage: ResolveImage = (id: string) => photoUrls[id];
  // The snapshot stores whatever locale the sharer was on; anything we no longer
  // ship degrades to the default rather than to Chinese.
  const lang = isLocale(locale) ? locale : defaultLocale;
  const aT = boundPick(lang);
  const t = {
    prevPage: aT('上一页', 'Previous'),
    nextPage: aT('下一页', 'Next'),
    noPages: aT('暂无内容', 'Nothing to show'),
    editPage: '',
  };
  // Resolved through the same overlay pipeline as the rest of the app, so es/ja/fr
  // readers get their language instead of silently falling back to Chinese.
  const cta = shareCta(aT);

  // The reader reached the closing spread. Dismissable, and dismissal sticks for
  // the session — re-nagging someone who already said "keep reading" is how a
  // referral prompt turns into a popup they close on reflex.
  const spreads = useMemo(() => buildSpreads(pages), [pages]);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const atEnd = isLastSpread(spreads, selected);
  const showCta = atEnd && !dismissed;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function shareThisBook() {
    const url = window.location.href;
    // Native sheet where it exists (that is where the actual forwarding happens
    // on phones); clipboard is the desktop fallback, not the primary path.
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // Cancelled or unavailable — fall through to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard blocked (insecure context, permissions). Nothing useful to
      // say here; the URL is already in the address bar.
    }
  }

  // 画板底:纯色 / 内置预设图(公开)可复现;上传图是本地引用,分享环境取不到 → 退中性底。
  const bgStyle: React.CSSProperties = {};
  if (boardBackground?.kind === 'color') bgStyle.background = boardBackground.color;
  else if (boardBackground?.kind === 'preset') {
    bgStyle.backgroundImage = `url("${presetImageUrl(boardBackground.presetId)}")`;
    bgStyle.backgroundSize = 'cover';
    bgStyle.backgroundPosition = 'center';
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-[var(--bg)]">
      {/* Logo left, title centred. The grid keeps the title optically centred on
          the page rather than centred in the space the logo leaves over. */}
      <header className="grid flex-shrink-0 grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-[var(--border-soft)] px-4 py-3">
        <Link
          href={`/${lang}`}
          className="flex items-center rounded transition-opacity hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          aria-label="Yujee"
        >
          {/* Plain <img>, matching how the landing and the editor render the mark
              — next/image cannot optimise an SVG anyway. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-yujee.svg" alt="Yujee" className="h-5 w-auto" />
        </Link>
        {/* The length:/color: hints are mandatory. An untyped arbitrary text
            utility holding a CSS variable compiles to `color:`, so a font-size
            token emits `color: 13px` — invalid at computed-value time, which
            resets colour to `unset` and silently beats any real colour class
            declared earlier in the sheet. That shipped the CTA button as black
            text on a black pill. Never write the untyped form here.
            (Do not spell the untyped form out in a comment either: Tailwind
            scans comments too and will emit the broken rule from the prose.) */}
        <h1 className="truncate text-center text-[length:var(--text-sm)] font-semibold text-[color:var(--fg)]">
          {title}
        </h1>
        {/* Balances the logo column so the title stays centred. */}
        <span aria-hidden="true" className="w-[72px]" />
      </header>
      <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden p-4 sm:p-8" style={bgStyle}>
        <FlipBook
          pages={pages}
          totalPages={pages.length}
          resolveImage={resolveImage}
          selected={selected}
          onSelect={setSelected}
          t={t}
        />

        {showCta ? (
          // Desktop: dim + blur the whole spread and centre the card — docking it
          // to the bottom edge covered the closing page, which is the one page the
          // reader is actually being asked to react to. Mobile keeps the bottom
          // sheet (thumb reach) and stays click-through.
          <div
            onClick={() => setDismissed(true)}
            className="pointer-events-none absolute inset-0 flex items-end justify-center p-4 sm:pointer-events-auto sm:items-center sm:bg-[color:var(--fg)]/25 sm:p-6 sm:backdrop-blur-md"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-auto w-full max-w-md rounded-2xl border border-[var(--border-soft)] bg-[color:var(--bg)]/95 p-5 text-center shadow-lg backdrop-blur sm:bg-[color:var(--bg)] sm:p-7 sm:shadow-2xl"
            >
              <p className="text-[length:var(--text-base)] font-semibold text-[color:var(--fg)]">{cta.title}</p>
              <p className="mt-1.5 text-[length:var(--text-sm)] leading-relaxed text-[color:var(--muted)]">{cta.body}</p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
                <Link
                  href={`/${lang}#homepage-composer`}
                  className="rounded-full bg-[color:var(--fg)] px-5 py-2.5 text-[length:var(--text-sm)] font-semibold text-[color:var(--bg)] transition-opacity hover:opacity-85"
                >
                  {cta.primary}
                </Link>
                <button
                  type="button"
                  onClick={shareThisBook}
                  className="rounded-full border border-[var(--border-soft)] px-5 py-2.5 text-[length:var(--text-sm)] font-medium text-[color:var(--fg)] transition-colors hover:bg-[var(--border-soft)]"
                >
                  {copied ? cta.copied : cta.secondary}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="mt-3 text-[length:var(--text-xs)] text-[color:var(--muted)] transition-colors hover:text-[color:var(--fg)]"
              >
                {cta.dismiss}
              </button>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
