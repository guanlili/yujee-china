import { createElement } from 'react';
import { Document, pdf } from '@react-pdf/renderer';
import { PDF_TEMPLATE_REGISTRY } from '@/components/album/pdf-registry';
import {
  adaptPageToTemplateData,
  type AdaptablePage,
  type ResolveImage,
} from '@/components/album/adapt-layout';

// IMPORTANT: only import this module via `await import('@/lib/pdf/render')` from
// a click handler. A static import would pull @react-pdf/renderer (~500kB) into
// the editor's first-load bundle (B8 review item 2).

export async function renderAlbumPdf(
  pages: AdaptablePage[],
  resolveImage: ResolveImage,
): Promise<Blob> {
  const total = pages.length;
  const children = pages
    .map((page, i) => {
      const PdfTemplate = PDF_TEMPLATE_REGISTRY[page.templateId];
      if (!PdfTemplate) return null;
      const data = adaptPageToTemplateData(page, resolveImage);
      return createElement(PdfTemplate, { key: i, data, totalPages: total });
    })
    .filter((child): child is NonNullable<typeof child> => child !== null);

  const doc = createElement(Document, {}, ...children);
  return pdf(doc).toBlob();
}
