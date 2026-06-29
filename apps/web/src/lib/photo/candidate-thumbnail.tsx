'use client';

// P2 rendered-thumbnail judge (docs/agent/contract.md §5.2.1). Given an Agent
// candidate (templateId + slot→photoId per page), render the REAL web templates
// with photos in their slots — text BLANKED, no @font-face needed (text isn't drawn,
// so Google-Fonts being geo-blocked never blocks here) — then snapshot DOM→canvas→
// downscaled JPEG. The small thumbnail (photos-in-slots, no text) is what the Agent's
// Gemini judge sees, instead of "structure JSON + bare photos + wireframe".
//
// Why html2canvas (not hand-composited canvas): the templates are a mix of
// absolute-positioned <img> (mag-04) AND CSS-grid / width:100% layouts (mag-10) with
// bracket-path slots. html2canvas-pro (already a dependency) renders ALL of them
// uniformly off one real React render, so we reuse the exact production layout instead
// of re-deriving slot geometry per template. We render React via createRoot into a
// detached-but-on-screen-offscreen node, wait for <img> decode, snapshot, then unmount.

import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import html2canvas from 'html2canvas-pro';
import { adaptPageToTemplateData } from '@/components/album/adapt-layout';
import { getWebTemplate } from '@/components/album/web-registry';
import { PAGE } from '@/components/album/templates/constants';
import { photoStore } from '@/lib/photo/store';
import type { CandidatePage } from '@yujee/contracts';

const THUMBNAIL_MAX_EDGE = 320;
const THUMBNAIL_QUALITIES = [0.6, 0.5, 0.42, 0.34];
export const THUMBNAIL_TARGET_BYTES = 30 * 1024;

export type CandidateForRender = {
  candidateIndex: number;
  pages: CandidatePage[];
};

function approxBytesOfDataUrl(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

// Off-screen but still laid out (display:none breaks measurement/paint, so we park it
// far outside the viewport instead). One container per render, removed in finally.
function makeOffscreenHost(): HTMLDivElement {
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-100000px';
  host.style.top = '0';
  host.style.width = `${PAGE.width}px`;
  host.style.background = '#ffffff';
  host.style.pointerEvents = 'none';
  host.style.zIndex = '-1';
  document.body.appendChild(host);
  return host;
}

function waitForImages(root: HTMLElement, timeoutMs = 5000): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'));
  const pending = imgs.filter((img) => !(img.complete && img.naturalWidth > 0));
  if (pending.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let done = 0;
    const finish = () => {
      done += 1;
      if (done >= pending.length) resolve();
    };
    for (const img of pending) {
      img.addEventListener('load', finish, { once: true });
      img.addEventListener('error', finish, { once: true });
    }
    // Never hang the whole flow on one slow/broken decode.
    setTimeout(resolve, timeoutMs);
  });
}

function downscaleToJpeg(source: HTMLCanvasElement): string | null {
  const longest = Math.max(source.width, source.height);
  const scale = longest > THUMBNAIL_MAX_EDGE ? THUMBNAIL_MAX_EDGE / longest : 1;
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);

  let last: string | null = null;
  for (const quality of THUMBNAIL_QUALITIES) {
    const dataUrl = out.toDataURL('image/jpeg', quality);
    last = dataUrl;
    if (approxBytesOfDataUrl(dataUrl) <= THUMBNAIL_TARGET_BYTES) break;
  }
  out.width = 0;
  out.height = 0;
  return last;
}

// Render one candidate's pages (photos in slots, no text) and snapshot to a single
// downscaled JPEG data-url. Returns null when there is no canvas / render fails — the
// caller then sends the unit with chosenIndex=0 so the Agent takes candidate 0.
export async function renderCandidateThumbnail(
  candidate: CandidateForRender,
  photosById: Record<string, string>,
): Promise<string | null> {
  if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') return null;

  const host = makeOffscreenHost();
  let root: Root | null = null;
  try {
    root = createRoot(host);
    const pageEls = candidate.pages.map((page, i) => {
      const Template = getWebTemplate(page.templateId);
      // texts:{} blanks every text slot (adaptPageToTemplateData fills missing text
      // with ''), so only the image slots carry real photo data-urls.
      const data = adaptPageToTemplateData(
        { templateId: page.templateId, images: page.images, texts: {} },
        (photoId) => photosById[photoId],
      );
      return createElement(
        'div',
        { key: i, style: { width: PAGE.width, height: PAGE.height, background: '#fff' } },
        Template ? createElement(Template, { data, totalPages: candidate.pages.length }) : null,
      );
    });
    root.render(createElement('div', null, pageEls));

    // Let React commit, then wait for the photo <img> decodes before snapshotting.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await waitForImages(host);

    // Mirror EditorPort.capturePageRender: html2canvas-pro (handles oklch/lab CSS
    // colors Tailwind v4 emits), full page width, scale 1, white bg.
    const canvas = await html2canvas(host, {
      width: PAGE.width,
      height: host.scrollHeight || PAGE.height * candidate.pages.length,
      backgroundColor: '#ffffff',
      scale: 1,
      useCORS: true,
      logging: false,
    });
    return downscaleToJpeg(canvas);
  } catch {
    return null;
  } finally {
    if (root) {
      try {
        root.unmount();
      } catch {
        // ignore
      }
    }
    host.remove();
  }
}

// Collect every photoId a set of candidate units references, so the caller can resolve
// them from the photo store once before rendering.
export function collectCandidatePhotoIds(
  units: Array<{ candidates: Array<{ pages: CandidatePage[] }> }>,
): string[] {
  const ids = new Set<string>();
  for (const unit of units) {
    for (const candidate of unit.candidates) {
      for (const page of candidate.pages) {
        for (const photoId of Object.values(page.images)) {
          if (photoId) ids.add(photoId);
        }
      }
    }
  }
  return [...ids];
}

// Resolve the originals the candidates reference to render-ready data-urls (reuses the
// proven photoStore decode path). Missing ids are simply absent → that slot renders empty.
export function resolveCandidatePhotos(photoIds: string[]): Promise<Record<string, string>> {
  return photoStore.getDataUrls(photoIds);
}
