'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAlbumPoll } from '@/lib/hooks/use-album-poll';
import { EditorPort } from '@/components/album/editor-v2/EditorPort';
import { AuthoringPort } from '@/components/album/v2/AuthoringPort';
import { AlbumGeneratingShell } from '@/components/album/AlbumGeneratingShell';
import { defaultLocale, isLocale, type Locale } from '@/lib/i18n/routing';

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

  // EDITING is two distinct product states that share one status: the DRAFT phase
  // (draft_json written, layout_json still null → the v2 authoring flow) and the
  // FINALIZED phase (layout_json set → the editor). layoutJson is the
  // discriminator (mirrors albumAuthoringService.loadDraftAlbum server-side).
  if (phase === 'ready' && detail) {
    const { status, layoutJson } = detail.album;
    if (status === 'EDITING' && layoutJson == null) {
      return <AuthoringPort albumId={uuid} locale={locale} />;
    }
    return <EditorPort detail={detail} locale={locale} />;
  }

  return (
    <AlbumGeneratingShell
      locale={locale}
      albumId={uuid}
      phase={phase === 'unauthorized' || phase === 'ready' ? 'loading' : phase}
      generation={generation}
      error={error}
    />
  );
}
