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
import { flushSync } from 'react-dom';
import { createElement } from 'react';
import html2canvas from 'html2canvas-pro';
import { adaptPageToTemplateData } from '@/components/album/adapt-layout';
import { getWebTemplate } from '@/components/album/web-registry';
import { PAGE } from '@/components/album/templates/constants';
import { photoStore } from '@/lib/photo/store';
import type { CandidatePage } from '@yujee/contracts';

// Per-PAGE long-edge budget (not whole-strip): a candidate is a vertical strip of N
// pages; scaling the STRIP to 320 made each page ~320/N tall — at N=4 the judge saw
// ~80px pages and couldn't tell crops/subjects apart. Scale relative to a single page
// instead so every page keeps ~PAGE_MAX_EDGE of detail regardless of page count.
const PAGE_MAX_EDGE = 320;
const THUMBNAIL_QUALITIES = [0.6, 0.5, 0.42, 0.34, 0.3];
export const THUMBNAIL_TARGET_BYTES = 100 * 1024;

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

// 快照出来的是不是"整张几乎一个颜色"(全白)。React 并发提交没落地就截图、或照片
// 全部没解出来时会出现这种图 —— 它对评委是纯噪音,调用方应重试或放弃该候选。
function isFlatCanvas(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = ctx.getImageData(0, 0, w, h).data;
  const first = [data[0], data[1], data[2]];
  const stride = 4 * 97; // 均匀抽样,97 素数避开条纹周期
  for (let i = stride; i < data.length; i += stride) {
    if (
      Math.abs(data[i] - first[0]) > 6 ||
      Math.abs(data[i + 1] - first[1]) > 6 ||
      Math.abs(data[i + 2] - first[2]) > 6
    ) {
      return false;
    }
  }
  return true;
}

function downscaleToJpeg(source: HTMLCanvasElement): { url: string; flat: boolean } | null {
  // The source canvas renders pages at full PAGE dims, so the per-page long edge is
  // max(PAGE.width, PAGE.height) no matter how many pages the strip stacks.
  const pageLongEdge = Math.max(PAGE.width, PAGE.height);
  const scale = Math.min(1, PAGE_MAX_EDGE / pageLongEdge);
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
  const flat = isFlatCanvas(ctx, w, h);

  let last: string | null = null;
  for (const quality of THUMBNAIL_QUALITIES) {
    const dataUrl = out.toDataURL('image/jpeg', quality);
    last = dataUrl;
    if (approxBytesOfDataUrl(dataUrl) <= THUMBNAIL_TARGET_BYTES) break;
  }
  out.width = 0;
  out.height = 0;
  return last ? { url: last, flat } : null;
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
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
    // createRoot().render() 是并发调度的异步提交:只等一帧 rAF 就截图,提交没落地时
    // host 里连 <img> 都没有 → waitForImages 零等待 → html2canvas 拍出整张白图,
    // 评委收到的就是纯噪音(实测同一照片同一模板,时序好坏各出一种结果)。
    // flushSync 强制本次 render 同步提交,截图前 DOM 一定就位。
    flushSync(() => {
      root!.render(createElement('div', null, pageEls));
    });

    await waitForImages(host);
    // 图片 load 后再让浏览器走两帧,布局/合成落定再拍。
    await nextFrame();
    await nextFrame();

    const snapshot = async () => {
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
    };

    let shot = await snapshot();
    if (shot?.flat) {
      // 全白兜底:再等两帧重拍一次;仍是白图说明该候选真渲染不出来(照片解不出等),
      // 返回 null 让上层按"无可用缩略图"降级,别把白图当候选喂给评委。
      await nextFrame();
      await nextFrame();
      shot = await snapshot();
      if (shot?.flat) return null;
    }
    return shot?.url ?? null;
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
