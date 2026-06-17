import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  adaptPageToTemplateData,
  type AdaptablePage,
  type ResolveImage,
} from '@/components/album/adapt-layout';
import { getWebTemplate } from '@/components/album/web-registry';
import { PAGE } from '@/components/album/templates/constants';

// #167: rasterize a rendered album page (the cover / first page) into a small
// JPEG Blob the browser can direct-upload to R2. This is the persistent cover
// thumbnail: a rendered DERIVATIVE, never an original photo. Originals stay in
// the browser (invariant 1) — they are only resolved here as blob: URLs to paint
// the page, exactly the same posture as the PDF export and #165 inspect-render.
//
// IMPORTANT: import this only via `await import('@/lib/pdf/rasterize')` from a
// handler/effect — it pulls in html2canvas-pro (heavy) and react-dom/server, so a
// static import would bloat the editor's first-load bundle.

// Default thumbnail width in CSS px. The /my-albums cards render covers in a
// 4:3 box at roughly ~200–300px wide, so 480px is crisp on retina while keeping
// the JPEG small (typically tens of KB).
const DEFAULT_WIDTH = 480;
const JPEG_QUALITY = 0.82;

export interface RasterizeOptions {
  /** Target bitmap width in px (height keeps the A4 page ratio). */
  width?: number;
  /** JPEG quality 0..1. */
  quality?: number;
  /**
   * Total page count threaded to templates that print folio numbers. The cover
   * doesn't show a folio, but the prop is required by the template contract.
   */
  totalPages?: number;
}

// Render a single page through its web template (the same path the editor/PDF
// use) into static markup we can drop into a detached host for html2canvas.
function pageMarkup(page: AdaptablePage, resolveImage: ResolveImage, totalPages: number): string {
  const Template = getWebTemplate(page.templateId);
  if (!Template) {
    return `<div style="padding:24px;font-size:14px">Unknown template: ${page.templateId}</div>`;
  }
  const data = adaptPageToTemplateData(page, resolveImage);
  return renderToStaticMarkup(
    createElement(Template, { data, totalPages, imagePos: page.imagePos ?? {} }),
  );
}

/**
 * Render the given page to a JPEG Blob at ~`width`px wide (A4 ratio preserved).
 * Returns null if the browser canvas pipeline is unavailable (e.g. a context
 * cannot be acquired) so callers can degrade silently rather than throw.
 */
export async function rasterizePageToBlob(
  page: AdaptablePage,
  resolveImage: ResolveImage,
  opts: RasterizeOptions = {},
): Promise<Blob | null> {
  const width = opts.width ?? DEFAULT_WIDTH;
  const quality = opts.quality ?? JPEG_QUALITY;
  const totalPages = opts.totalPages ?? 1;

  // Render the page at full A4 resolution into a detached, off-screen host so the
  // capture is crisp and independent of any on-screen zoom/flip state.
  const host = document.createElement('div');
  host.style.cssText =
    `position:fixed;left:-99999px;top:0;width:${PAGE.width}px;height:${PAGE.height}px;` +
    `overflow:hidden;background:#fff`;
  host.innerHTML = pageMarkup(page, resolveImage, totalPages);
  document.body.appendChild(host);
  try {
    // html2canvas-pro (not the unmaintained html2canvas@1.4.1) — the latter
    // throws on modern CSS color functions (oklch/lab/color-mix) that Tailwind v4
    // emits. Matches the #165 capturePageRender choice.
    const html2canvas = (await import('html2canvas-pro')).default;
    const canvas = await html2canvas(host, {
      width: PAGE.width,
      height: PAGE.height,
      backgroundColor: '#ffffff',
      scale: 1,
      useCORS: true,
      logging: false,
    });
    // Downscale to the target width (A4 ratio preserved) before encoding.
    const targetW = Math.min(width, canvas.width);
    const targetH = Math.round((canvas.height / canvas.width) * targetW);
    const out = document.createElement('canvas');
    out.width = targetW;
    out.height = targetH;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0, targetW, targetH);
    return await new Promise<Blob | null>((resolve) =>
      out.toBlob((b) => resolve(b), 'image/jpeg', quality),
    );
  } finally {
    host.remove();
  }
}
