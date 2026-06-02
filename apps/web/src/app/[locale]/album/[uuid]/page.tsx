'use client';

import { use, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAlbumPoll } from '@/lib/hooks/use-album-poll';
import { AlbumEditor } from '@/components/album/AlbumEditor';
import { RetryFailedButton } from '@/components/album/RetryFailedButton';
import { defaultLocale, isLocale, type Locale } from '@/lib/i18n/routing';
import { getMessages } from '@/lib/i18n/messages';

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
  const t = getMessages(locale).dashboard.editor;
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

  const showEditor =
    phase === 'ready' &&
    detail &&
    (detail.album.status === 'EDITING' || detail.album.status === 'COMPLETED');

  if (showEditor) {
    return <AlbumEditor detail={detail} locale={locale} />;
  }

  const stage = generation?.stage;
  const stageLabel =
    (stage && (t.stage as Record<string, string>)[stage]) ?? stage ?? t.stage.starting;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-6 py-10">
      {phase === 'failed' ? (
        <div className="text-center">
          <p className="text-3xl font-bold text-[#c44]">{t.failedTitle}</p>
          <p className="mt-3 text-[var(--muted)]">{error ?? t.failedBodyDefault}</p>
          <p className="mt-1 text-[var(--text-sm)] text-[var(--muted)]">{t.failedNoCharge}</p>
          <div className="flex justify-center">
            <RetryFailedButton albumId={uuid} />
          </div>
          <Link
            href={`/${locale}/my-albums`}
            className="mt-6 inline-block text-[var(--text-sm)] text-[var(--accent)] underline underline-offset-2"
          >
            {t.backToProjects}
          </Link>
        </div>
      ) : phase === 'gone' ? (
        <div className="text-center">
          <p className="text-3xl font-bold text-[#c44]">{t.goneTitle}</p>
          <p className="mt-3 text-[var(--muted)]">{t.goneBody}</p>
          <Link
            href={`/${locale}/my-albums`}
            className="mt-6 inline-block text-[var(--text-sm)] text-[var(--accent)] underline underline-offset-2"
          >
            {t.backToProjects}
          </Link>
        </div>
      ) : phase === 'error' ? (
        <div className="text-center">
          <p className="text-3xl font-bold">{t.slowTitle}</p>
          <p className="mt-3 text-[var(--muted)]">{error ?? t.slowBody}</p>
        </div>
      ) : (
        <div className="text-center">
          <p className="mb-4 text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
            {phase === 'loading' ? t.stateLoading : t.stateGenerating}
          </p>
          <p className="mb-6 text-3xl font-bold">{stageLabel}</p>
          <div className="mx-auto h-1.5 max-w-md overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full bg-[var(--accent)] transition-all duration-700"
              style={{ width: `${generation?.progress ?? 0}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">{generation?.progress ?? 0}%</p>
        </div>
      )}
    </main>
  );
}
