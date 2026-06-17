'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';
import { AppChrome } from '@/components/app/AppChrome';
import { AlbumCoverPreview, type AlbumCoverPage } from '@/components/album/AlbumCoverPreview';
import { RetryFailedButton } from '@/components/album/RetryFailedButton';
import { photoStore } from '@/lib/photo/store';
import {
  submitInitV2,
  photosFromStore,
  CreditInsufficientError,
  PhotosUnavailableError,
} from '@/lib/generation/client';
import { generationDraft, albumRecipe } from '@/lib/generation/draft';

type Album = {
  id: string;
  title: string;
  status: 'AGENT_RUNNING' | 'EDITING' | 'COMPLETED' | 'FAILED';
  photoCount: number;
  pageCount: number;
  pdfUrl: string | null;
  createdAt: string;
  coverPage: AlbumCoverPage | null;
};

// Decorative cover tints cycled by index — albums have no cover image yet, so
// each card gets a calm placeholder "page" like the design mockup.
const COVER_TINTS = ['#e8e8e8', '#eaeaea', '#e5e5e5', '#ececec', '#e7e7e7'];

// How often to re-poll the list while a card is still generating, so a finished
// or swept album flips to its editing/failed skin without a manual refresh.
const POLL_MS = 4000;

export default function MyAlbumsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = use(params);
  const t = getMessages(locale).dashboard;

  const router = useRouter();
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setErr(null);
    try {
      const res = await fetch('/api/v1/albums');
      const json = await res.json();
      if (!json.ok) {
        setErr(json.error?.message ?? t.common.error);
        setAlbums([]);
        return;
      }
      setAlbums(json.data);
    } catch {
      setErr(t.common.error);
      setAlbums([]);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the list fresh only while something is mid-generation. The list
  // endpoint already sweeps zombie jobs (album-service.listByUser), so a quiet
  // re-fetch is enough to surface completion or failure on its own.
  const anyRunning = (albums ?? []).some((a) => a.status === 'AGENT_RUNNING');
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => loadRef.current(), POLL_MS);
    return () => clearInterval(id);
  }, [anyRunning]);

  const remove = async (id: string) => {
    if (!window.confirm(t.myAlbums.confirmDelete)) return;
    setDeleting(id);
    setErr(null);
    try {
      const res = await fetch(`/api/v1/albums/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.ok) {
        setAlbums((prev) => (prev ?? []).filter((a) => a.id !== id));
      } else {
        setErr(json.error?.message ?? t.common.error);
      }
    } catch {
      setErr(t.common.error);
    } finally {
      setDeleting(null);
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return '';
    }
  };

  // Hover-revealed delete control. Rendered as a card-level sibling that sits
  // above the cover link (never a <button> nested in an <a>), so clicking it
  // deletes without also opening the album and the markup stays valid.
  const deleteButton = (a: Album) => (
    <div className="absolute right-2 top-2 z-[5] flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      <button
        type="button"
        title={t.myAlbums.delete}
        aria-label={t.myAlbums.delete}
        disabled={deleting === a.id}
        onClick={() => remove(a.id)}
        className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-white/85 text-[var(--fg-2)] shadow-[0_1px_4px_rgba(0,0,0,0.08)] backdrop-blur transition-colors hover:bg-white disabled:opacity-40"
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
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>
    </div>
  );

  const coverDecor = (i: number) => (
    <div className="flex h-full w-full items-center justify-center">
      <div
        className="relative h-[65%] w-[55%] rounded-[var(--radius-sm)]"
        style={{ background: COVER_TINTS[i % COVER_TINTS.length] }}
      >
        <span className="absolute left-[18%] top-[24%] h-[6px] w-[55%] rounded bg-black/10" />
        <span className="absolute left-[18%] top-[40%] h-[5px] w-[70%] rounded bg-black/[0.06]" />
      </div>
    </div>
  );

  const card = (a: Album, i: number) => {
    const date = (
      <>
        <div className="truncate text-[15px] font-semibold">{a.title}</div>
        <div className="mt-0.5 text-xs text-[var(--meta)]">
          {t.myAlbums.createdOn.replace('{date}', formatDate(a.createdAt))}
        </div>
      </>
    );

    if (a.status === 'AGENT_RUNNING') {
      return (
        <div
          key={a.id}
          className="group relative block overflow-hidden rounded-[var(--radius-lg)] bg-[var(--surface)] shadow-[var(--shadow-card)] transition-transform duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]"
        >
          <Link href={`/${locale}/album/${a.id}`} className="block">
            <div className="relative aspect-[4/3] overflow-hidden bg-[var(--bg)]">
              <AlbumCoverPreview
                coverPage={a.coverPage}
                pageCount={a.pageCount}
                fallback={coverDecor(i)}
              />
              <div className="absolute inset-0 z-[2] bg-[rgba(245,245,245,0.62)] backdrop-blur-[2px]" />
              <div className="absolute left-2 top-2 z-[4] inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold leading-none shadow-[0_1px_4px_rgba(0,0,0,0.1)] backdrop-blur">
                <span className="badge-spin" />
                {t.myAlbums.status.AGENT_RUNNING}
              </div>
              <div className="absolute inset-0 z-[3] flex flex-col items-center justify-center gap-2.5 text-center">
                <span className="gen-ring" />
                <div className="text-[13px] font-semibold text-[var(--fg-2)]">
                  {t.myAlbums.generatingLabel}
                </div>
              </div>
            </div>
          </Link>
          <div className="px-3.5 py-3">{date}</div>
        </div>
      );
    }

    if (a.status === 'FAILED') {
      return (
        <div
          key={a.id}
          className="group relative block overflow-hidden rounded-[var(--radius-lg)] bg-[var(--surface)] shadow-[var(--shadow-card)] transition-transform duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]"
        >
          {deleteButton(a)}
          <div className="relative aspect-[4/3] overflow-hidden bg-[var(--bg)]">
            <AlbumCoverPreview
              coverPage={a.coverPage}
              pageCount={a.pageCount}
              fallback={coverDecor(i)}
            />
            <div className="absolute inset-0 z-[2] bg-[rgba(17,17,17,0.55)] backdrop-blur-[2px]" />
            <div className="absolute left-2 top-2 z-[4] inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold leading-none shadow-[0_1px_4px_rgba(0,0,0,0.1)] backdrop-blur">
              <span className="h-[7px] w-[7px] rounded-full bg-[#E5484D]" />
              {t.myAlbums.status.FAILED}
            </div>
            <div className="absolute inset-0 z-[3] flex flex-col items-center justify-center gap-2 px-3 text-center">
              <svg
                className="h-[30px] w-[30px] text-white/90"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <div className="text-[13px] font-semibold text-white">{t.myAlbums.failedLabel}</div>
              <RetryFailedButton albumId={a.id} variant="card" />
            </div>
          </div>
          <div className="px-3.5 py-3">{date}</div>
        </div>
      );
    }

    // COMPLETED / EDITING — the whole card opens the album.
    return (
      <div
        key={a.id}
        className="group relative block overflow-hidden rounded-[var(--radius-lg)] bg-[var(--surface)] shadow-[var(--shadow-card)] transition-transform duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]"
      >
        {deleteButton(a)}
        <Link href={`/${locale}/album/${a.id}`} className="block">
          <div className="relative aspect-[4/3] overflow-hidden bg-[var(--bg)]">
            <AlbumCoverPreview
              coverPage={a.coverPage}
              pageCount={a.pageCount}
              fallback={coverDecor(i)}
            />
          </div>
        </Link>
        <Link href={`/${locale}/album/${a.id}`} className="block px-3.5 py-3 text-inherit">
          {date}
        </Link>
      </div>
    );
  };

  // New-album entry: pick photos directly, then create the album and jump straight
  // to the authoring page, which shows the loading placeholder while the AI runs.
  // The theme is asked there in the chat — nothing to type up front. Originals live
  // in IndexedDB (invariant 1); base64 is rebuilt at submit. The balance gate runs
  // on the click (before any upload); 0 books stashes a draft and routes to top up,
  // resuming on the home composer.
  const startNewAlbum = async (files: FileList | null) => {
    if (!files || files.length === 0 || creating) return;
    setCreating(true);
    setErr(null);
    const language: 'zh' | 'en' = locale === 'zh' ? 'zh' : 'en';
    const photoIds: string[] = [];
    try {
      for (const f of Array.from(files).slice(0, 30)) {
        const photoId = crypto.randomUUID();
        await photoStore.put(photoId, f);
        photoIds.push(photoId);
      }
      // No client-side balance pre-check: uploading photos is cheap and is the
      // investment we want before any paywall. The billing gate is server-side,
      // right before the AI runs — submitInitV2 throws CREDIT_INSUFFICIENT (caught
      // below) before the agent is called.
      const builtPhotos = await photosFromStore(photoIds);
      const { albumId } = await submitInitV2({
        requestId: crypto.randomUUID(),
        language,
        photos: builtPhotos,
      });
      albumRecipe.save(albumId, { language, photoIds });
      router.push(`/${locale}/album/${albumId}`);
    } catch (e) {
      if (e instanceof CreditInsufficientError) {
        generationDraft.save({ prompt: '', language, photoIds });
        router.push(`/${locale}/credits?from=home`);
        return;
      }
      setErr(e instanceof PhotosUnavailableError ? t.create.errPhotosUnavailable : e instanceof Error ? e.message : t.common.error);
      setCreating(false);
    }
  };

  // Grid-first "+" entry. Clicking opens the OS photo picker directly; selecting
  // photos starts the album and navigates away. Sized h-full to match the album
  // cards beside it (design-v1 Home 1).
  const newCard = (
    <label
      key="__new__"
      title={t.myAlbums.create}
      aria-label={t.myAlbums.create}
      aria-busy={creating}
      className={`group grid h-full cursor-pointer place-items-center rounded-[var(--radius-lg)] bg-[var(--surface)] border-2 border-solid border-[var(--border)] text-[var(--muted)] shadow-[var(--shadow-card)] transition hover:shadow-[var(--shadow-card-hover)] hover:-translate-y-0.5 hover:border-[var(--grad-green)] hover:text-[var(--grad-green)] ${creating ? 'pointer-events-none opacity-60' : ''}`}
    >
      <input
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        disabled={creating}
        onChange={(e) => {
          void startNewAlbum(e.target.files);
          e.target.value = '';
        }}
      />
      {creating ? (
        <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-[var(--border)] border-t-[var(--grad-green)]" />
      ) : (
        <svg
          className="w-12 h-12 transition-transform group-hover:scale-110"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <line x1="12" y1="5" x2="12" y2="19" />
        </svg>
      )}
    </label>
  );

  return (
    <AppChrome locale={locale} activeNav="projects">
      <div className="mx-auto w-full max-w-[1200px] px-10 py-8">
        <div className="mb-7">
          <h1 className="text-2xl font-bold tracking-tight">{t.myAlbums.title}</h1>
        </div>

        {err && <p className="mb-6 text-sm text-red-600">{err}</p>}

        {albums === null && <p className="text-[var(--muted)]">{t.common.loading}</p>}

        {albums !== null && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5">
            {newCard}
            {albums.map((a, i) => card(a, i))}
          </div>
        )}
      </div>
    </AppChrome>
  );
}
