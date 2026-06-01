'use client';

import { use, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAlbumPoll } from '@/lib/hooks/use-album-poll';
import { AlbumEditor } from '@/components/album/AlbumEditor';
import { detectLocale, localizePath } from '@/lib/i18n/routing';

const STAGE_LABEL: Record<string, string> = {
  vision: 'AI is looking at your photos…',
  writing: 'AI is writing your story…',
  composing: 'AI is laying out the pages…',
};

export default function AlbumPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  // Source of truth is the album itself, addressed by uuid — not a job id from
  // the URL. A bookmarked/ready album loads immediately; a dead generation is
  // swept to FAILED server-side and surfaces here instead of spinning forever.
  const { detail, generation, phase, error } = useAlbumPoll(uuid);

  // Session expired mid-generation → don't spin, send them to sign in and back.
  // detectLocale falls back to the default for an unprefixed path (the create
  // flow pushes /album/<uuid>), and localizePath normalizes `from` to a real
  // localized URL — so login and the post-login return both land on /<locale>/….
  useEffect(() => {
    if (phase === 'unauthorized') {
      const locale = detectLocale(pathname);
      const from = localizePath(pathname, locale);
      router.push(`/${locale}/login?from=${encodeURIComponent(from)}`);
    }
  }, [phase, router, pathname]);

  const showEditor =
    phase === 'ready' &&
    detail &&
    (detail.album.status === 'EDITING' || detail.album.status === 'COMPLETED');

  return (
    <main className="min-h-screen max-w-6xl mx-auto px-6 py-10">
      {showEditor ? (
        <AlbumEditor detail={detail} />
      ) : phase === 'failed' ? (
        <div className="text-center py-24">
          <p className="serif text-3xl text-red-700">Something went wrong</p>
          <p className="mt-3 text-[var(--muted)]">{error ?? 'Generation failed.'}</p>
        </div>
      ) : phase === 'gone' ? (
        <div className="text-center py-24">
          <p className="serif text-3xl text-red-700">Couldn&rsquo;t open this album</p>
          <p className="mt-3 text-[var(--muted)]">
            It may have been removed, or it isn&rsquo;t available on this account.
          </p>
        </div>
      ) : phase === 'error' ? (
        <div className="text-center py-24">
          <p className="serif text-3xl">This is taking longer than expected</p>
          <p className="mt-3 text-[var(--muted)]">
            {error ?? 'Still working on it — refresh to check back.'}
          </p>
        </div>
      ) : (
        <div className="text-center py-24">
          <p className="uppercase tracking-[0.3em] text-xs text-[var(--muted)] mb-4">
            {phase === 'loading' ? 'LOADING' : 'GENERATING'}
          </p>
          <p className="serif text-3xl mb-6">
            {generation?.stage ? STAGE_LABEL[generation.stage] ?? generation.stage : 'Starting…'}
          </p>
          <div className="max-w-md mx-auto h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
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
