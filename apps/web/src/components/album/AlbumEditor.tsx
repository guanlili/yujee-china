'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '@/lib/i18n/routing';
import { getMessages } from '@/lib/i18n/messages';
import { photoStore } from '@/lib/photo/store';
import { collectPhotoIds } from './adapt-layout';
import { PagePreview } from './PagePreview';
import { PageEditPanel } from './PageEditPanel';
import { ChatPanel } from './ChatPanel';
import { EditorTopbar, type SaveState } from './EditorTopbar';
import { PAGE } from './templates/constants';
import {
  applyPatchToPages,
  extractPhotoIds,
  type AlbumDetail,
  type EditorPage,
  type LayoutPatchEntry,
} from './types';

interface Props {
  detail: AlbumDetail;
  locale: Locale;
}

// UI-1a functional editor (design-v1 editor.html, minus the 3D book → UI-1b):
// solid topbar + accurate flat single-page preview + per-page edit drawer + rich
// AI chat + browser-side PDF export. Center renders the real web template at the
// canonical 794×1123 canvas, scaled to fit the pane.
export function AlbumEditor({ detail, locale }: Props) {
  const t = getMessages(locale).dashboard.editor;
  const albumId = detail.album.id;
  const layoutJson = detail.album.layoutJson;

  const [pages, setPages] = useState<EditorPage[]>(detail.pages);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [title, setTitle] = useState(detail.album.title);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(detail.album.pdfUrl);

  // UI strings follow the route locale; the album's *content* language (what the
  // agent writes in) is fixed at generation time and read from the layout.
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

  // One save lane for the whole editor: every persisting action drives the
  // topbar autosave badge so "Saved" is honest across title, page, and chat edits.
  const runSave = useCallback(async (fn: () => Promise<Response | void>) => {
    setSaveState('saving');
    try {
      const res = await fn();
      if (res && 'ok' in res && !res.ok) throw new Error('save failed');
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }, []);

  const patchPage = (pageIndex: number, patch: Partial<EditorPage>) =>
    setPages((prev) => prev.map((p) => (p.pageIndex === pageIndex ? { ...p, ...patch } : p)));

  const renameAlbum = (next: string) => {
    setTitle(next);
    void runSave(() =>
      fetch(`/api/v1/albums/${albumId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: next }),
      }),
    );
  };

  const saveText = (pageIndex: number, slot: string, value: string) => {
    const page = pages.find((p) => p.pageIndex === pageIndex);
    if (!page) return;
    const textsJson = { ...page.textsJson, [slot]: value };
    patchPage(pageIndex, { textsJson });
    void runSave(() =>
      fetch(`/api/v1/albums/${albumId}/pages/${pageIndex}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ textsJson }),
      }),
    );
  };

  const saveImage = (pageIndex: number, slot: string, photoId: string) => {
    const page = pages.find((p) => p.pageIndex === pageIndex);
    if (!page) return;
    const imagesJson = { ...page.imagesJson, [slot]: photoId };
    patchPage(pageIndex, { imagesJson });
    void runSave(() =>
      fetch(`/api/v1/albums/${albumId}/pages/${pageIndex}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagesJson }),
      }),
    );
  };

  const onChatPatch = (patch: LayoutPatchEntry[]) => {
    setPages((prev) => applyPatchToPages(prev, patch));
    setSaveState('saved'); // chat persists server-side before returning the patch
  };

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
        setExportErr(t.exportCloudError);
      }
    } catch (e) {
      console.error('PDF export failed', e);
      setExportErr(t.exportError);
    } finally {
      setExporting(false);
    }
  };

  const total = pages.length;
  const clampedSelected = Math.min(selected, Math.max(0, total - 1));
  const selectedPage = pages[clampedSelected];

  // Fit one canonical page into the available preview area.
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const padX = 64;
      const padY = 96; // room for the bottom nav pill
      const sx = (el.clientWidth - padX) / PAGE.width;
      const sy = (el.clientHeight - padY) / PAGE.height;
      setScale(Math.max(0.25, Math.min(0.85, Math.min(sx, sy))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const goTo = (i: number) => {
    if (i < 0 || i >= total) return;
    setSelected(i);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg)]">
      <EditorTopbar
        locale={locale}
        title={title}
        saveState={saveState}
        exporting={exporting}
        downloadUrl={downloadUrl}
        onRename={renameAlbum}
        onExport={exportPdf}
      />

      {exportErr && (
        <p className="flex-shrink-0 bg-[#fff7ed] px-6 py-2 text-[var(--text-xs)] text-[#b45309]">{exportErr}</p>
      )}

      <div className="relative grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_340px]">
        {/* CENTER — flat preview */}
        <main ref={stageRef} className="relative flex items-center justify-center overflow-auto bg-[var(--bg)] p-8">
          {selectedPage ? (
            <div className="group relative">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                title={t.editPage}
                aria-label={t.editPage}
                className="absolute -right-3 -top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--fg-2)] opacity-0 shadow-[var(--shadow-card)] transition-opacity hover:text-[var(--fg)] group-hover:opacity-100"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="block cursor-pointer"
                title={t.editPage}
              >
                <PagePreview page={selectedPage} totalPages={total} resolveImage={resolveImage} scale={scale} />
              </button>
            </div>
          ) : (
            <p className="text-[var(--text-sm)] text-[var(--muted)]">{t.noPages}</p>
          )}

          {/* bottom nav pill */}
          {total > 0 && (
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[rgba(255,255,255,0.85)] px-3 py-1.5 shadow-[0_2px_12px_rgba(0,0,0,0.08)] backdrop-blur-md">
              <button
                type="button"
                onClick={() => goTo(clampedSelected - 1)}
                disabled={clampedSelected === 0}
                title={t.prevPage}
                aria-label={t.prevPage}
                className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--fg)] disabled:opacity-30"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <span className="min-w-[36px] text-center font-mono text-[10px] font-medium tabular-nums text-[var(--fg-2)]">
                {t.pageIndicator.replace('{current}', String(clampedSelected + 1)).replace('{total}', String(total))}
              </span>
              <button
                type="button"
                onClick={() => goTo(clampedSelected + 1)}
                disabled={clampedSelected >= total - 1}
                title={t.nextPage}
                aria-label={t.nextPage}
                className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--fg)] disabled:opacity-30"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          )}
        </main>

        {/* RIGHT — chat */}
        <aside className="hidden border-l border-[var(--border-soft)] lg:block">
          <ChatPanel albumId={albumId} locale={locale} language={language} onPatch={onChatPatch} />
        </aside>

        {/* EDIT DRAWER */}
        {drawerOpen && selectedPage && (
          <>
            <div
              className="absolute inset-0 z-20 bg-black/20"
              onClick={() => setDrawerOpen(false)}
              aria-hidden
            />
            <div className="absolute inset-y-0 right-0 z-30 flex w-full max-w-[400px] flex-col bg-[var(--surface)] shadow-[var(--shadow-card-hover)]">
              <div className="flex flex-shrink-0 items-center justify-between border-b border-[var(--border-soft)] px-5 py-4">
                <h3 className="text-[var(--text-sm)] font-bold">
                  {t.editPageTitle.replace('{n}', String(clampedSelected + 1))}
                </h3>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="rounded-full bg-[var(--fg)] px-4 py-1.5 text-[var(--text-xs)] font-semibold text-white transition-colors hover:bg-[var(--fg-2)]"
                >
                  {t.done}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                <PageEditPanel
                  page={selectedPage}
                  locale={locale}
                  availablePhotoIds={availablePhotoIds}
                  imageUrls={imageUrls}
                  onSaveText={(slot, value) => saveText(selectedPage.pageIndex, slot, value)}
                  onSaveImage={(slot, photoId) => saveImage(selectedPage.pageIndex, slot, photoId)}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
