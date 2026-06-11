'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAlbumPoll } from '@/lib/hooks/use-album-poll';
import { EditorPort } from '@/components/album/editor-v2/EditorPort';
import { AlbumGeneratingShell } from '@/components/album/AlbumGeneratingShell';
import type { AlbumDetail } from '@/components/album/types';
import { defaultLocale, isLocale, type Locale } from '@/lib/i18n/routing';

// building mode renders the editor chrome + a loading book and never reads page
// content, so the first (pre-detail) poll frame can hand it this minimal stub.
const STUB_DETAIL = (uuid: string): AlbumDetail => ({
  album: {
    id: uuid,
    title: '',
    status: 'AGENT_RUNNING',
    prompt: '',
    layoutJson: null,
    photoCount: 0,
    pageCount: 0,
    pdfUrl: null,
    errorMessage: null,
    createdAt: new Date(0).toISOString(),
  },
  pages: [],
});

// Editor lives under [locale] for 2-language support (architecture §6.5.7). The
// create flow still pushes the unprefixed /album/<uuid>; next-intl middleware
// (localePrefix: 'always') redirects it here with the resolved locale prefix, so
// this is the single real implementation — no stub re-export.
export default function AlbumPage({
  params,
}: {
  params: Promise<{ locale: string; uuid: string }>;
}) {
  const { locale: rawLocale, uuid } = use(params);
  const locale: Locale = isLocale(rawLocale) ? rawLocale : defaultLocale;
  const router = useRouter();

  // Source of truth is the album itself, addressed by uuid — not a job id from
  // the URL. A bookmarked/ready album loads immediately; a dead generation is
  // swept to FAILED server-side and surfaces here instead of spinning forever.
  const { detail, generation, phase, error } = useAlbumPoll(uuid);

  // Session expired mid-generation → don't spin, send them to sign in and back.
  useEffect(() => {
    if (phase === 'unauthorized') {
      const from = `/${locale}/album/${uuid}`;
      router.push(`/${locale}/login?from=${encodeURIComponent(from)}`);
    }
  }, [phase, router, locale, uuid]);

  // The editor is now the single page across the whole album lifecycle (W10 flow
  // unification): EditorPort renders for every non-terminal phase, switching mode
  // internally. We no longer route to the standalone AuthoringPort (kept only as a
  // fallback). page.tsx owns just the mode decision:
  //   • loading / running (AGENT_RUNNING) → building: loading book + "tidying up".
  //   • EDITING & layoutJson == null      → authoring: draft skeleton + agent chat.
  //   • layoutJson set (EDITING/COMPLETED)→ editing: the finalized editor.
  // layoutJson is the draft↔finalized discriminator (mirrors the server's
  // albumAuthoringService.loadDraftAlbum). Leaving and returning via the URL
  // resumes naturally: a fresh useAlbumPoll re-derives the phase.
  if (phase === 'loading' || phase === 'running') {
    // First frame has no detail yet; building mode ignores it, so a stub is fine.
    return (
      <EditorPort
        detail={detail ?? STUB_DETAIL(uuid)}
        locale={locale}
        mode="building"
      />
    );
  }

  if (phase === 'ready' && detail) {
    const { status, layoutJson } = detail.album;
    const mode = status === 'EDITING' && layoutJson == null ? 'authoring' : 'editing';
    return <EditorPort detail={detail} locale={locale} mode={mode} />;
  }

  // Terminal error states (failed / gone / error / unauthorized) still reuse the
  // generating shell — it's now only an error/terminal surface, never the
  // "processing" page. (unauthorized also triggers the redirect effect above.)
  // Only failed / gone / error remain as real shell states. unauthorized (handled
  // by the redirect effect above) and the rare ready-without-detail fall back to a
  // neutral loading shell for the frame before navigation/re-render resolves.
  const shellPhase = phase === 'failed' || phase === 'gone' || phase === 'error' ? phase : 'loading';
  return (
    <AlbumGeneratingShell
      locale={locale}
      albumId={uuid}
      phase={shellPhase}
      generation={generation}
      error={error}
    />
  );
}
