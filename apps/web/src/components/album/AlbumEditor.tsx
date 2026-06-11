'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Locale } from '@/lib/i18n/routing';
import { getMessages } from '@/lib/i18n/messages';
import { photoStore } from '@/lib/photo/store';
import { collectPhotoIds } from './adapt-layout';
import { FlipBook } from './FlipBook';
import { PageEditPanel } from './PageEditPanel';
import { ChatPanel } from './ChatPanel';
import { EditorTopbar, type SaveState } from './EditorTopbar';
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

// Album editor (design-v1 editor.html): solid topbar + 3D perspective flipbook
// preview (UI-1b) + per-page edit drawer + rich AI chat + browser-side PDF
// export. The flipbook is the preview/navigation layer only — all UI-1a
// functionality (editing, chat, export, topbar, retry) is unchanged; pages
// still render through the real web templates at the canonical 794×1123 canvas.
export function AlbumEditor({ detail, locale }: Props) {
  const t = getMessages(locale).dashboard.editor;
  const albumId = detail.album.id;
  const layoutJson = detail.album.layoutJson;

  const [pages, setPages] = useState<EditorPage[]>(detail.pages);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
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

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-[var(--bg)]">
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

      {/* v2 layout (design-v1 editor.html): chat = flush-left collapsible card,
          preview = central canvas. The grid keeps the test's scroll-isolation
          contract (flex-1 min-h-0 overflow-hidden) while column-ordering puts
          chat on the left on desktop. */}
      <style>{`
        /* Chat is a desktop-only flush-left card; the editor stays preview-first
           on mobile (matches UI-1a). Collapse swaps the grid to a single track. */
        [data-chat-aside]{ display:none; }
        @media (min-width:1024px){
          [data-editor-grid][data-chat-collapsed="false"]{ grid-template-columns:360px minmax(0,1fr); }
          [data-editor-grid][data-chat-collapsed="true"]{ grid-template-columns:minmax(0,1fr); }
          [data-editor-grid][data-chat-collapsed="false"] [data-chat-aside]{ display:block; }
        }
      `}</style>
      <div
        data-editor-grid
        data-chat-collapsed={chatCollapsed}
        className="relative grid flex-1 min-h-0 grid-cols-1 overflow-hidden"
      >
        {/* LEFT — chat card (collapsible). Desktop-only flush-left card; on
            mobile the editor stays preview-first (matches UI-1a behaviour). */}
        <aside className="order-1 h-full min-h-0 min-w-0 overflow-hidden" data-chat-aside style={{ transition: 'width var(--motion-base) var(--ease)' }}>
          <div className="h-full overflow-hidden border-[var(--border-soft)] lg:rounded-r-[18px] lg:border lg:border-l-0 lg:shadow-[0_8px_30px_rgba(0,0,0,0.10)]">
            <ChatPanel
              albumId={albumId}
              locale={locale}
              language={language}
              onPatch={onChatPatch}
              onCollapse={() => setChatCollapsed(true)}
            />
          </div>
        </aside>

        {/* CENTER — 3D flipbook preview + canvas chrome (thumbnail strip, zoom, overview, spread rail) */}
        <main className="relative order-2 min-h-0 min-w-0 overflow-hidden bg-[var(--bg)] p-8">
          {/* Expand tab — only when the chat card is fully collapsed (design .chat-fold-expand) */}
          {chatCollapsed && (
            <button
              type="button"
              onClick={() => setChatCollapsed(false)}
              title={t.expandChat}
              aria-label={t.expandChat}
              className="absolute left-2 top-1/2 z-[45] hidden h-10 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--border-soft)] bg-[var(--surface)] text-[var(--muted)] transition-colors hover:text-[var(--fg)] lg:flex"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
          <FlipBook
            pages={pages}
            totalPages={total}
            resolveImage={resolveImage}
            selected={clampedSelected}
            onSelect={setSelected}
            onEditPage={(i) => {
              setSelected(i);
              setDrawerOpen(true);
            }}
            t={{
              prevPage: t.prevPage,
              nextPage: t.nextPage,
              noPages: t.noPages,
              editPage: t.editPage,
              pageIndicator: t.pageIndicator,
              overview: t.overview,
              zoomIn: t.zoomIn,
              zoomOut: t.zoomOut,
              resetZoom: t.resetZoom,
              chaptersLabel: t.chaptersLabel,
              collapseChapters: t.collapseChapters,
              expandChapters: t.expandChapters,
              spreadLabel: t.spreadLabel,
            }}
          />
        </main>

        {/* EDIT DRAWER */}
        {drawerOpen && selectedPage && (
          <>
            <div
              className="absolute inset-0 z-20 bg-black/20"
              onClick={() => setDrawerOpen(false)}
              aria-hidden
            />
            <div className="absolute inset-y-0 right-0 z-30 flex min-h-0 w-full max-w-[400px] flex-col bg-[var(--surface)] shadow-[var(--shadow-card-hover)]">
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
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
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
