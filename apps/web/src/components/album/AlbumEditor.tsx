'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { photoStore } from '@/lib/photo/store';
import { collectPhotoIds } from './adapt-layout';
import { PagePreview } from './PagePreview';
import { PageEditPanel } from './PageEditPanel';
import { ChatPanel } from './ChatPanel';
import {
  applyPatchToPages,
  extractPhotoIds,
  type AlbumDetail,
  type EditorPage,
  type LayoutPatchEntry,
} from './types';

interface Props {
  detail: AlbumDetail;
}

export function AlbumEditor({ detail }: Props) {
  const albumId = detail.album.id;
  const layoutJson = detail.album.layoutJson;
  const [pages, setPages] = useState<EditorPage[]>(detail.pages);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(detail.album.pdfUrl);

  const language: 'zh' | 'en' =
    (layoutJson as { magazine?: { language?: string } } | null)?.magazine?.language === 'zh'
      ? 'zh'
      : 'en';

  const adaptable = useMemo(
    () => pages.map((p) => ({ templateId: p.templateId, images: p.imagesJson, texts: p.textsJson })),
    [pages],
  );

  const availablePhotoIds = useMemo(() => {
    const merged = new Set([...extractPhotoIds(layoutJson), ...collectPhotoIds(adaptable)]);
    return [...merged];
  }, [layoutJson, adaptable]);

  const photoKey = availablePhotoIds.join(',');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const urls = await photoStore.getObjectUrls(photoKey ? photoKey.split(',') : []);
      if (!cancelled) setImageUrls(urls);
    })();
    return () => {
      cancelled = true;
    };
  }, [photoKey]);

  const resolveImage = useCallback((photoId: string) => imageUrls[photoId], [imageUrls]);

  const patchPage = (pageIndex: number, patch: Partial<EditorPage>) =>
    setPages((prev) => prev.map((p) => (p.pageIndex === pageIndex ? { ...p, ...patch } : p)));

  const saveText = async (pageIndex: number, slot: string, value: string) => {
    const page = pages.find((p) => p.pageIndex === pageIndex);
    if (!page) return;
    const textsJson = { ...page.textsJson, [slot]: value };
    patchPage(pageIndex, { textsJson });
    await fetch(`/api/v1/albums/${albumId}/pages/${pageIndex}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textsJson }),
    });
  };

  const saveImage = async (pageIndex: number, slot: string, photoId: string) => {
    const page = pages.find((p) => p.pageIndex === pageIndex);
    if (!page) return;
    const imagesJson = { ...page.imagesJson, [slot]: photoId };
    patchPage(pageIndex, { imagesJson });
    await fetch(`/api/v1/albums/${albumId}/pages/${pageIndex}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagesJson }),
    });
  };

  const onChatPatch = (patch: LayoutPatchEntry[]) => setPages((prev) => applyPatchToPages(prev, patch));

  const exportPdf = async () => {
    setExporting(true);
    setExportErr(null);
    try {
      const ids = collectPhotoIds(adaptable);
      const dataUrls = await photoStore.getDataUrls(ids);
      const { renderAlbumPdf } = await import('@/lib/pdf/render');
      const blob = await renderAlbumPdf(adaptable, (id) => dataUrls[id]);

      // Always offer the locally-rendered file so export is useful even if R2
      // isn't configured (e.g. local mock runs).
      setDownloadUrl(URL.createObjectURL(blob));

      try {
        const signRes = await fetch(`/api/v1/albums/${albumId}/pdf-upload-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentType: 'application/pdf', size: blob.size }),
        });
        const signJson = await signRes.json();
        if (!signJson.ok) throw new Error(signJson.error?.message ?? 'sign failed');
        const { putUrl, r2Key, publicUrl } = signJson.data;

        // Direct browser → R2 PUT. PDF bytes never pass through the Web tier
        // (invariant 4).
        const putRes = await fetch(putUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/pdf' },
          body: blob,
        });
        if (!putRes.ok) throw new Error(`R2 PUT ${putRes.status}`);

        const notifyRes = await fetch(`/api/v1/albums/${albumId}/pdf`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ r2Key }),
        });
        const notifyJson = await notifyRes.json();
        if (notifyJson.ok) setDownloadUrl(notifyJson.data.pdfUrl ?? publicUrl);
      } catch (uploadErr) {
        console.error('PDF cloud upload failed', uploadErr);
        setExportErr('Your PDF is ready to download below, but saving it to the cloud failed. Please try again later.');
      }
    } catch (e) {
      console.error('PDF export failed', e);
      setExportErr('Something went wrong while preparing your PDF. Please check your connection and try again.');
    } finally {
      setExporting(false);
    }
  };

  const selectedPage = pages.find((p) => p.pageIndex === selected) ?? pages[0];

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border)] pb-6 mb-8">
        <div>
          <p className="uppercase tracking-[0.3em] text-xs text-[var(--muted)] mb-2">Your memoir</p>
          <h1 className="serif text-4xl">{detail.album.title}</h1>
          <p className="mt-2 text-[var(--muted)] italic">{detail.album.prompt}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={exportPdf}
            disabled={exporting}
            className="px-6 py-2.5 rounded-full bg-[var(--accent)] text-white text-sm tracking-wide disabled:opacity-40"
          >
            {exporting ? 'Exporting…' : 'Export PDF'}
          </button>
          {downloadUrl && (
            <a href={downloadUrl} target="_blank" rel="noreferrer" className="text-sm underline">
              Download PDF
            </a>
          )}
        </div>
      </header>

      {exportErr && <p className="mb-6 text-sm text-amber-700">{exportErr}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
        <div className="flex flex-wrap gap-5 content-start">
          {pages.map((page) => (
            <button
              key={page.pageIndex}
              type="button"
              onClick={() => setSelected(page.pageIndex)}
              onDoubleClick={() => setSelected(page.pageIndex)}
              className={`block rounded ${
                page.pageIndex === selected ? 'ring-2 ring-[var(--accent)]' : ''
              }`}
              title={`Page ${page.pageIndex + 1}`}
            >
              <PagePreview page={page} totalPages={pages.length} resolveImage={resolveImage} />
            </button>
          ))}
        </div>

        <aside className="space-y-8">
          <section className="bg-[var(--paper2,#efe8d8)] rounded-lg p-5">
            {selectedPage ? (
              <PageEditPanel
                page={selectedPage}
                availablePhotoIds={availablePhotoIds}
                imageUrls={imageUrls}
                onSaveText={(slot, value) => saveText(selectedPage.pageIndex, slot, value)}
                onSaveImage={(slot, photoId) => saveImage(selectedPage.pageIndex, slot, photoId)}
              />
            ) : (
              <p className="text-sm text-[var(--muted)]">No pages.</p>
            )}
          </section>

          <section className="bg-white border border-[var(--border)] rounded-lg p-5 h-[420px]">
            <ChatPanel albumId={albumId} language={language} onPatch={onChatPatch} />
          </section>
        </aside>
      </div>
    </div>
  );
}
