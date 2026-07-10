import { createElement } from 'react';
import { Document, pdf } from '@react-pdf/renderer';
import { PDF_TEMPLATE_REGISTRY } from '@/components/album/pdf-registry';
import { withRegisteredPdfFonts } from '@/components/album/templates/pdf-utils';
import type { PdfFontSubset } from '@/components/album/templates/pdf-utils';
import {
  adaptPageToTemplateData,
  type AdaptablePage,
  type ResolveImage,
} from '@/components/album/adapt-layout';
import {
  collectAlbumFontRequest,
  type AlbumFontRequest,
} from '@/lib/font/album-font-request';

// IMPORTANT: only import this module via `await import('@/lib/pdf/render')` from
// a click handler. A static import would pull @react-pdf/renderer (~500kB) into
// the editor's first-load bundle (B8 review item 2).

async function fetchSubsetFonts(request: AlbumFontRequest): Promise<PdfFontSubset> {
  const res = await fetch('/api/v1/fonts/subset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error?.message ?? 'font subset failed');
  return {
    sans: json.data.sansBase64,
    serif: json.data.serifBase64,
    artFonts: json.data.artFonts,
  };
}

export async function renderAlbumPdf(
  pages: AdaptablePage[],
  resolveImage: ResolveImage,
): Promise<Blob> {
  const subset = await fetchSubsetFonts(collectAlbumFontRequest(pages));
  return withRegisteredPdfFonts(subset, async () => {
    const total = pages.length;
    const children = pages
      .map((page, i) => {
        const PdfTemplate = PDF_TEMPLATE_REGISTRY[page.templateId];
        if (!PdfTemplate) return null;
        const data = adaptPageToTemplateData(page, resolveImage);
        return createElement(PdfTemplate, { key: i, data, totalPages: total, imagePos: page.imagePos });
      })
      .filter((child): child is NonNullable<typeof child> => child !== null);

    const doc = createElement(Document, {}, ...children);
    return pdf(doc).toBlob();
  });
}
