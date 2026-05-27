'use client';

import { use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type JobStatus = {
  requestId: string;
  albumId: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  stage: string | null;
  progress: number;
  error: { code: string; message: string } | null;
};

type Page = {
  pageIndex: number;
  templateId: string;
  imagesJson: Record<string, string>;
  textsJson: Record<string, string>;
};

type AlbumDetail = {
  album: {
    id: string;
    title: string;
    status: string;
    prompt: string;
    layoutJson: unknown;
    photoCount: number;
    pageCount: number;
    errorMessage: string | null;
  };
  pages: Page[];
};

type StoredPhoto = { photoId: string; base64: string };

const STAGE_LABEL: Record<string, string> = {
  vision: 'AI is looking at your photos…',
  writing: 'AI is writing your story…',
  composing: 'AI is laying out the pages…',
};

export default function AlbumPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = use(params);
  const search = useSearchParams();
  const requestId = search.get('job');

  const [job, setJob] = useState<JobStatus | null>(null);
  const [detail, setDetail] = useState<AlbumDetail | null>(null);
  const [photoMap, setPhotoMap] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`photos:${uuid}`);
      if (raw) {
        const arr = JSON.parse(raw) as StoredPhoto[];
        const map: Record<string, string> = {};
        for (const p of arr) map[p.photoId] = p.base64;
        setPhotoMap(map);
      }
    } catch {}
  }, [uuid]);

  useEffect(() => {
    if (!requestId) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      const res = await fetch(`/api/v1/jobs/${requestId}`);
      const json = await res.json();
      if (!json.ok) return;
      setJob(json.data);
      if (json.data.status === 'COMPLETED' || json.data.status === 'FAILED') {
        if (timer) clearInterval(timer);
        if (json.data.status === 'COMPLETED') await loadDetail();
      }
    };
    tick();
    timer = setInterval(tick, 2000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [requestId]);

  const loadDetail = async () => {
    const res = await fetch(`/api/v1/albums/${uuid}`);
    const json = await res.json();
    if (json.ok) setDetail(json.data);
  };

  useEffect(() => {
    if (!requestId) loadDetail();
  }, [requestId, uuid]);

  const renderProgress = () => {
    if (!job) return null;
    if (job.status === 'COMPLETED') return null;
    if (job.status === 'FAILED') {
      return (
        <div className="text-center py-20">
          <p className="serif text-3xl text-red-700">Something went wrong</p>
          <p className="mt-3 text-[var(--muted)]">{job.error?.message ?? 'Unknown error'}</p>
        </div>
      );
    }
    const label = job.stage ? STAGE_LABEL[job.stage] ?? job.stage : 'Starting…';
    return (
      <div className="text-center py-20">
        <p className="uppercase tracking-[0.3em] text-xs text-[var(--muted)] mb-4">
          {job.status}
        </p>
        <p className="serif text-3xl mb-6">{label}</p>
        <div className="max-w-md mx-auto h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
          <div
            className="h-full bg-[var(--accent)] transition-all duration-700"
            style={{ width: `${job.progress}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">{job.progress}%</p>
      </div>
    );
  };

  const renderDetail = () => {
    if (!detail) return null;
    return (
      <div>
        <header className="text-center py-12 border-b border-[var(--border)]">
          <p className="uppercase tracking-[0.3em] text-xs text-[var(--muted)] mb-3">
            Your memoir
          </p>
          <h1 className="serif text-5xl">{detail.album.title}</h1>
          <p className="mt-3 text-[var(--muted)] italic">{detail.album.prompt}</p>
        </header>

        <div className="py-12 space-y-16">
          {detail.pages.map((p) => (
            <PageView key={p.pageIndex} page={p} photoMap={photoMap} />
          ))}
        </div>

        <footer className="border-t border-[var(--border)] py-10 text-center text-sm text-[var(--muted)]">
          <p>PDF export coming soon. (This is a demo build — Agent runs in mock mode.)</p>
        </footer>
      </div>
    );
  };

  return (
    <main className="min-h-screen max-w-4xl mx-auto px-6 py-10">
      {renderProgress()}
      {renderDetail()}
    </main>
  );
}

function PageView({ page, photoMap }: { page: Page; photoMap: Record<string, string> }) {
  const imageEntries = Object.entries(page.imagesJson);
  const textEntries = Object.entries(page.textsJson);
  return (
    <section className="bg-white rounded-lg p-8 shadow-sm border border-[var(--border)]">
      <p className="uppercase tracking-[0.2em] text-[10px] text-[var(--muted)] mb-4">
        Page {page.pageIndex + 1} · {page.templateId}
      </p>
      <div className="grid grid-cols-2 gap-4 mb-6">
        {imageEntries.map(([slot, photoId]) => {
          const src = photoMap[photoId];
          return (
            <div key={slot}>
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt={slot} className="w-full aspect-[4/3] object-cover rounded" />
              ) : (
                <div className="w-full aspect-[4/3] rounded bg-[var(--grad-lime)] flex items-center justify-center text-xs text-[var(--muted)]">
                  {photoId} (original not in this browser session)
                </div>
              )}
              <p className="mt-1 text-[10px] text-[var(--muted)] uppercase">{slot}</p>
            </div>
          );
        })}
      </div>
      <div className="space-y-2">
        {textEntries.map(([slot, value]) => (
          <p key={slot} className={slot === 'title' ? 'serif text-2xl' : 'text-base'}>
            {value}
          </p>
        ))}
      </div>
    </section>
  );
}
