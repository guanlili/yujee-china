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
export function RetryFailedButton({ albumId }: { albumId: string }) {
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
    return (
      <p className="mt-6 text-sm text-[var(--muted)]">
        These photos are no longer on this device.{' '}
        <a href={`/${detectLocale(pathname)}/create`} className="underline">
          Start a new memoir
        </a>
        .
      </p>
    );
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={retry}
        disabled={busy}
        className="px-8 py-3 rounded-full bg-[var(--accent)] text-white text-sm tracking-wide disabled:opacity-40"
      >
        {busy ? 'Retrying…' : 'Try again'}
      </button>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
