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
import { injectDocumentFontsInto } from '@/lib/font/clone-document-fonts';
import { PAGE, pageBox } from '@/components/album/templates/constants';
import { photoStore } from '@/lib/photo/store';
import type { CandidatePage } from '@yujee/contracts';

// Per-PAGE long-edge budget (not whole-strip): a candidate is a vertical strip of N
// pages; scaling the STRIP to 320 made each page ~320/N tall — at N=4 the judge saw
// ~80px pages and couldn't tell crops/subjects apart. Scale relative to a single page
// instead so every page keeps ~PAGE_MAX_EDGE of detail regardless of page count.
const PAGE_MAX_EDGE = 320;
// 页码标注(用户 2026-07-17):每页上方一条深色「第 N / M 页」标签 + 页间留白,让选排版评委
// 一眼看清一个候选有几页、每页啥样(此前多页无缝竖排成一条,页界/页数难辨)。尺寸按渲染分辨率
// 给,downscale(scale≈PAGE_MAX_EDGE/页长边)后标签仍清晰可读。
const PAGE_LABEL_HEIGHT = 76;
const PAGE_LABEL_FONT = 52;
const PAGE_GAP = 28;
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
// `width` (#303): the widest page box in the candidate's own page strip — a spread
// page (double-wide) sitting among regular pages must not clip against a fixed A4 host.
function makeOffscreenHost(width: number): HTMLDivElement {
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-100000px';
  host.style.top = '0';
  host.style.width = `${width}px`;
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
// 只在给定区域抽样判白。加了页码条后必须只看【第一页内容区】(跳过深色页码条),否则页码条
// 本身非白 → 整张恒判"非白",这个"渲染没落地/照片全没解出来 → 纯白噪音"的兜底就废了。
function isFlatRegion(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): boolean {
  if (w <= 0 || h <= 0) return true;
  const data = ctx.getImageData(x, y, w, h).data;
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

function downscaleToJpeg(
  source: HTMLCanvasElement,
  box: { width: number; height: number },
): { url: string; flat: boolean } | null {
  // The source canvas renders pages at full page-box dims (#303: box is the widest page
  // in this candidate's strip — PAGE for every template today), so the per-page long
  // edge is max(box.width, box.height) no matter how many pages the strip stacks.
  const pageLongEdge = Math.max(box.width, box.height);
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
  // 判白只看第一页内容区(跳过顶部页码条),否则页码条使整张恒"非白"、兜底失效。
  const bandY = Math.round(PAGE_LABEL_HEIGHT * scale);
  const bandH = Math.min(h - bandY, Math.round(box.height * scale));
  const flat = isFlatRegion(ctx, 0, bandY, w, bandH);

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

  // #303: a candidate's page strip can mix a spread template (double-wide) with
  // regular pages; size the whole strip to the widest page box so nothing clips.
  // For every template today pageBox() === PAGE, so stripBox === {PAGE.width, PAGE.height}
  // exactly as before.
  const pageBoxes = candidate.pages.map((page) => pageBox(page.templateId));
  const stripBox =
    pageBoxes.length > 0
      ? {
          width: Math.max(...pageBoxes.map((b) => b.width)),
          height: Math.max(...pageBoxes.map((b) => b.height)),
        }
      : { width: PAGE.width, height: PAGE.height };

  const host = makeOffscreenHost(stripBox.width);
  let root: Root | null = null;
  try {
    root = createRoot(host);
    const totalPages = candidate.pages.length;
    const pageEls = candidate.pages.map((page, i) => {
      const Template = getWebTemplate(page.templateId);
      const box = pageBoxes[i];
      // texts:{} blanks every text slot (adaptPageToTemplateData fills missing text
      // with ''), so only the image slots carry real photo data-urls.
      const data = adaptPageToTemplateData(
        { templateId: page.templateId, images: page.images, texts: {} },
        (photoId) => photosById[photoId],
      );
      return createElement(
        'div',
        { key: i, style: { width: box.width, marginBottom: i < totalPages - 1 ? PAGE_GAP : 0 } },
        // 页码标注条:烙进缩略图,评委据此数页数 + 分辨每页(第 N / M 页)。
        createElement(
          'div',
          {
            style: {
              width: '100%',
              height: PAGE_LABEL_HEIGHT,
              background: '#1c1b18',
              color: '#ffffff',
              fontSize: PAGE_LABEL_FONT,
              fontWeight: 800,
              letterSpacing: '0.06em',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
            },
          },
          `第 ${i + 1} / ${totalPages} 页`,
        ),
        createElement(
          'div',
          { style: { width: box.width, height: box.height, background: '#fff' } },
          Template ? createElement(Template, { data, totalPages: candidate.pages.length }) : null,
        ),
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
        width: stripBox.width,
        height: host.scrollHeight || stripBox.height * candidate.pages.length,
        backgroundColor: '#ffffff',
        scale: 1,
        useCORS: true,
        logging: false,
        // 动态字体注入克隆文档,评委看到的缩略图词距才和真实渲染一致(clone-document-fonts)。
        onclone: injectDocumentFontsInto,
      });
      return downscaleToJpeg(canvas, stripBox);
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
