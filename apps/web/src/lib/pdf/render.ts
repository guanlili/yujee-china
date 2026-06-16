import { createElement } from 'react';
import { Document, pdf } from '@react-pdf/renderer';
import { PDF_TEMPLATE_REGISTRY } from '@/components/album/pdf-registry';
import { registerPdfFonts } from '@/components/album/templates/pdf-utils';
import {
  adaptPageToTemplateData,
  type AdaptablePage,
  type ResolveImage,
} from '@/components/album/adapt-layout';

// IMPORTANT: only import this module via `await import('@/lib/pdf/render')` from
// a click handler. A static import would pull @react-pdf/renderer (~500kB) into
// the editor's first-load bundle (B8 review item 2).

// Always keep printable ASCII + common CJK punctuation, so static Latin labels
// in templates (folio numbers, "MEMOIR", "VOL") and any punctuation survive the
// subset even when a page's text doesn't happen to use them.
const BASE_CHARS =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`' +
  'abcdefghijklmnopqrstuvwxyz{|}~' +
  '。，、；：？！“”‘’（）〈〉《》「」『』【】〔〕…—～·／％＃＆＊';

// Matches the POST /api/v1/fonts/subset guard. A real memoir never approaches
// this many unique glyphs; if one somehow does, keep BASE_CHARS + the first
// chars seen rather than hard-failing the whole export — degrade, don't cliff.
const CHARSET_LIMIT = 5000;

function collectCharset(pages: AdaptablePage[]): string {
  const chars = new Set<string>();
  for (const c of BASE_CHARS) chars.add(c);
  for (const page of pages) {
    for (const text of Object.values(page.texts)) {
      for (const c of text) chars.add(c);
    }
  }
  const all = Array.from(chars);
  return (all.length > CHARSET_LIMIT ? all.slice(0, CHARSET_LIMIT) : all).join('');
}

async function fetchSubsetFonts(charset: string): Promise<{ sans: string; serif: string }> {
  const res = await fetch('/api/v1/fonts/subset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ charset }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error?.message ?? 'font subset failed');
  return { sans: json.data.sansBase64, serif: json.data.serifBase64 };
}

export async function renderAlbumPdf(
  pages: AdaptablePage[],
  resolveImage: ResolveImage,
): Promise<Blob> {
  const subset = await fetchSubsetFonts(collectCharset(pages));
  registerPdfFonts(subset);

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
}
