'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { getMessages } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/routing';
import { AppChrome } from '@/components/app/AppChrome';

type Album = {
  id: string;
  title: string;
  status: 'AGENT_RUNNING' | 'EDITING' | 'COMPLETED' | 'FAILED';
  photoCount: number;
  pageCount: number;
  pdfUrl: string | null;
  createdAt: string;
};

const STATUS_STYLE: Record<Album['status'], string> = {
  AGENT_RUNNING: 'bg-amber-100 text-amber-800',
  EDITING: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
};

export default function MyAlbumsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = use(params);
  const t = getMessages(locale).dashboard;

  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

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

  return (
    <AppChrome locale={locale} activeNav="projects">
      <div className="max-w-4xl mx-auto px-6 py-16">
      <div className="flex items-center justify-between mb-10">
        <h1 className="serif text-4xl">{t.myAlbums.title}</h1>
        <Link
          href={`/${locale}/create`}
          className="text-sm rounded-full bg-[var(--accent)] text-white px-5 py-2.5"
        >
          {t.myAlbums.create}
        </Link>
      </div>

      {err && <p className="mb-6 text-sm text-red-600">{err}</p>}

      {albums === null && <p className="text-[var(--muted)]">{t.common.loading}</p>}

      {albums !== null && albums.length === 0 && !err && (
        <div className="text-[var(--muted)]">
          <p>{t.myAlbums.empty}</p>
          <Link href={`/${locale}/create`} className="underline">
            {t.myAlbums.startFirst}
          </Link>
        </div>
      )}

      <ul className="space-y-4">
        {(albums ?? []).map((a) => (
          <li
            key={a.id}
            className="border border-[var(--border)] rounded-lg p-5 bg-white flex items-center justify-between gap-4"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <p className="serif text-2xl truncate">{a.title}</p>
                <span
                  className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                    STATUS_STYLE[a.status] ?? 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {t.myAlbums.status[a.status] ?? a.status}
                </span>
              </div>
              <p className="text-xs text-[var(--muted)] mt-1">
                {t.myAlbums.meta
                  .replace('{photos}', String(a.photoCount))
                  .replace('{pages}', String(a.pageCount))}
              </p>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <Link href={`/${locale}/album/${a.id}`} className="text-sm underline">
                {t.myAlbums.open}
              </Link>
              <button
                type="button"
                onClick={() => remove(a.id)}
                disabled={deleting === a.id}
                className="text-sm text-red-600 disabled:opacity-40"
              >
                {deleting === a.id ? t.myAlbums.deleting : t.myAlbums.delete}
              </button>
            </div>
          </li>
        ))}
      </ul>
      </div>
    </AppChrome>
  );
}
