'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  retryGeneration,
  photosFromStore,
  CreditInsufficientError,
  PhotosUnavailableError,
} from '@/lib/generation/client';
import { albumRecipe } from '@/lib/generation/draft';
import { detectLocale } from '@/lib/i18n/routing';

// Retry a FAILED album by reusing the same albumId (§6.5.3). The browser resends
// base64 rebuilt from the originals in IndexedDB; the server reuses the stored
// prompt + runs a fresh precheck/hold. Shared by /album/[uuid] and /my-albums.
//
// Two honest dead-ends surface inline rather than failing silently:
//   • the originals aren't on this device (cleared cache / different browser) —
//     invariant 1 means they can't be recovered, so we point to a fresh start;
//   • not enough credits — route to /credits (the checkout entry), then the user
//     comes back and the still-FAILED card lets them retry again (originals +
//     recipe persisted).
// `variant` lets callers reuse the exact retry logic in two skins:
//   • 'default' — the full-width pill on the /album failed screen (unchanged).
//   • 'card'    — the compact icon button inside a /my-albums failed cover.
export function RetryFailedButton({
  albumId,
  variant = 'default',
}: {
  albumId: string;
  variant?: 'default' | 'card';
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const retry = async () => {
    setBusy(true);
    setError(null);
    const recipe = albumRecipe.load(albumId);
    // No recipe means we never knew which originals to resend (e.g. the card was
    // created on another device) — there's nothing to rebuild from.
    if (!recipe || recipe.photoIds.length === 0) {
      setUnavailable(true);
      setBusy(false);
      return;
    }
    let photos;
    try {
      photos = await photosFromStore(recipe.photoIds);
    } catch (e) {
      if (e instanceof PhotosUnavailableError) {
        setUnavailable(true);
        setBusy(false);
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      return;
    }
    try {
      await retryGeneration(albumId, {
        requestId: crypto.randomUUID(),
        language: recipe.language,
        photos,
      });
      // Album is AGENT_RUNNING again; reload so the poll loop restarts from a
      // non-terminal state (useAlbumPoll only re-arms on uuid change / remount).
      window.location.reload();
    } catch (e) {
      if (e instanceof CreditInsufficientError) {
        // Route to /credits (the checkout entry, not /pricing). No draft stashed:
        // the album stays FAILED with its recipe persisted, so after top-up the
        // user returns to this still-FAILED card and retries the SAME album
        // (§6.5.3) — a /create draft would wrongly spin up a new album instead.
        const locale = detectLocale(pathname);
        router.push(`/${locale}/credits?from=album`);
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  if (unavailable) {
    if (variant === 'card') {
      return (
        <p className="px-3 text-center text-[11px] leading-snug text-white/85">
          Photos no longer on this device.{' '}
          <a href={`/${detectLocale(pathname)}#homepage-composer`} className="underline">
            Start new
          </a>
        </p>
      );
    }
    return (
      <p className="mt-6 text-sm text-[var(--muted)]">
        These photos are no longer on this device.{' '}
        <a href={`/${detectLocale(pathname)}#homepage-composer`} className="underline">
          Start a new memoir
        </a>
        .
      </p>
    );
  }

  if (variant === 'card') {
    return (
      <>
        <button
          type="button"
          onClick={retry}
          disabled={busy}
          className="mt-0.5 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3.5 py-1.5 text-xs font-semibold text-[var(--fg)] shadow-[0_1px_4px_rgba(0,0,0,0.18)] transition-transform hover:-translate-y-px disabled:opacity-50"
        >
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          {busy ? 'Retrying…' : 'Try again'}
        </button>
        {error && <p className="mt-1.5 px-3 text-center text-[11px] text-red-200">{error}</p>}
      </>
    );
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={retry}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-full bg-[var(--fg)] px-8 py-3 text-[var(--text-sm)] font-semibold text-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-all hover:-translate-y-px hover:bg-[var(--fg-2)] disabled:translate-y-0 disabled:opacity-40"
      >
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
        {busy ? 'Retrying…' : 'Try again'}
      </button>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
