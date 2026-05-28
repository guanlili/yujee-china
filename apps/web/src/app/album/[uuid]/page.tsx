'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useJobPoll } from '@/lib/hooks/use-job-poll';
import { AlbumEditor } from '@/components/album/AlbumEditor';
import type { AlbumDetail } from '@/components/album/types';

const STAGE_LABEL: Record<string, string> = {
  vision: 'AI is looking at your photos…',
  writing: 'AI is writing your story…',
  composing: 'AI is laying out the pages…',
};

export default function AlbumPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = use(params);
  const requestId = useSearchParams().get('job');
  const job = useJobPoll(requestId);

  const [detail, setDetail] = useState<AlbumDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const loadDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/albums/${uuid}`);
      const json = await res.json();
      if (json.ok) setDetail(json.data);
      else setLoadError(json.error?.message ?? 'Failed to load album');
    } catch (e) {
      setLoadError(String(e));
    }
  }, [uuid]);

  // No job to poll → the album already exists; load it directly.
  useEffect(() => {
    if (!requestId && !loadedRef.current) {
      loadedRef.current = true;
      void loadDetail();
    }
  }, [requestId, loadDetail]);

  // Poll finished → fetch the freshly-written layout once.
  useEffect(() => {
    if (job.status === 'COMPLETED' && !loadedRef.current) {
      loadedRef.current = true;
      void loadDetail();
    }
  }, [job.status, loadDetail]);

  const showEditor = detail && (detail.album.status === 'EDITING' || detail.album.status === 'COMPLETED');

  return (
    <main className="min-h-screen max-w-6xl mx-auto px-6 py-10">
      {showEditor ? (
        <AlbumEditor detail={detail} />
      ) : job.status === 'FAILED' ? (
        <div className="text-center py-24">
          <p className="serif text-3xl text-red-700">Something went wrong</p>
          <p className="mt-3 text-[var(--muted)]">
            {job.error?.message ?? detail?.album.errorMessage ?? 'Generation failed.'}
          </p>
        </div>
      ) : job.status === 'TIMEOUT' ? (
        <div className="text-center py-24">
          <p className="serif text-3xl">This is taking longer than expected</p>
          <p className="mt-3 text-[var(--muted)]">The task may have failed — refresh to check.</p>
        </div>
      ) : loadError ? (
        <div className="text-center py-24">
          <p className="serif text-3xl text-red-700">Couldn&rsquo;t load this album</p>
          <p className="mt-3 text-[var(--muted)]">{loadError}</p>
        </div>
      ) : (
        <div className="text-center py-24">
          <p className="uppercase tracking-[0.3em] text-xs text-[var(--muted)] mb-4">{job.status}</p>
          <p className="serif text-3xl mb-6">
            {job.stage ? (STAGE_LABEL[job.stage] ?? job.stage) : 'Starting…'}
          </p>
          <div className="max-w-md mx-auto h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
            <div
              className="h-full bg-[var(--accent)] transition-all duration-700"
              style={{ width: `${job.progress}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">{job.progress}%</p>
        </div>
      )}
    </main>
  );
}
