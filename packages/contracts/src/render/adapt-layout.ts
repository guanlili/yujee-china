import { getTemplate } from '../templates';
import {
  THEME_ACCENT_CARRIER_SUFFIX,
  THEME_FONT_CARRIER_SUFFIX,
} from '../theme-carrier';
import type { ImagePos, TemplateArrayItem, TemplateData } from './types';

// Adaptor seam (assigned to B3 by the B8 review). The agent emits each page as
// two flat string maps:
//   images: { slotKey: photoId }   texts: { slotKey: string }
// where slotKey may be a bracket path ("cells[0].image", "items[0].title").
// Template components want a single merged blob whose array slots are real
// arrays of objects. This module rebuilds that shape and resolves photoIds to
// renderable image sources.

export interface AdaptablePage {
  templateId: string;
  images: Record<string, string>;
  texts: Record<string, string>;
  // #165 per-slot position/scale overrides, threaded straight to the template as
  // the `imagePos` prop (not merged into `data`, so bracket-path slots like
  // `cells[0].image` keep an addressable key). Absent => renderer default 50/50/1.
  imagePos?: Record<string, ImagePos>;
}

export type ResolveImage = (photoId: string) => string | undefined;

type PathSeg = string | number;
type Node = Record<string, unknown> | unknown[];

function parsePath(key: string): PathSeg[] {
  const segs: PathSeg[] = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(key)) !== null) {
    if (m[2] !== undefined) segs.push(Number(m[2]));
    else segs.push(m[1]!);
  }
  return segs;
}

function setPath(root: Record<string, unknown>, key: string, value: unknown): void {
  const path = parsePath(key);
  if (path.length === 0) return;
  let node: Node = root;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i]!;
    const wantArray = typeof path[i + 1] === 'number';
    const current = (node as Record<PathSeg, unknown>)[seg];
    if (wantArray) {
      if (!Array.isArray(current)) (node as Record<PathSeg, unknown>)[seg] = [];
    } else if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      (node as Record<PathSeg, unknown>)[seg] = {};
    }
    node = (node as Record<PathSeg, unknown>)[seg] as Node;
  }
  (node as Record<PathSeg, unknown>)[path[path.length - 1]!] = value;
}

function isThemeCarrierKey(key: string): boolean {
  return key.endsWith(THEME_ACCENT_CARRIER_SUFFIX) || key.endsWith(THEME_FONT_CARRIER_SUFFIX);
}

// Declared-array slots must reach the component as an array. The mock planner
// (and a sloppy model) can emit the slot as a single string; wrap it so
// components that `.map` over it never crash.
function toArrayItems(value: unknown): TemplateArrayItem[] {
  if (Array.isArray(value)) {
    return value
      .filter((el) => el != null)
      .map((el) =>
        typeof el === 'string' ? { body: el, caption: el } : (el as TemplateArrayItem),
      );
  }
  if (typeof value === 'string') return [{ body: value, caption: value }];
  if (typeof value === 'object' && value !== null) return [value as TemplateArrayItem];
  return [];
}

export function adaptPageToTemplateData(
  page: AdaptablePage,
  resolveImage: ResolveImage,
): TemplateData {
  const result: Record<string, unknown> = {};

  for (const [key, text] of Object.entries(page.texts)) {
    if (isThemeCarrierKey(key)) {
      result[key] = text;
      continue;
    }
    setPath(result, key, text);
  }
  for (const [key, photoId] of Object.entries(page.images)) {
    setPath(result, key, resolveImage(photoId) ?? '');
  }

  const tpl = getTemplate(page.templateId);
  if (tpl) {
    for (const s of tpl.texts) {
      // 预览占位:用户未写该文案(空/缺失)时,用模板的 sample 示例占位(纯渲染态,
      // 不进 draft 数据)。folio/页码等 code 已填的装饰不受影响(它们已有值)。
      const current = result[s.id];
      if (s.sample && (current === undefined || current === '')) {
        result[s.id] = s.sample;
      }
      if (s.repeat === true && result[s.id] !== undefined) {
        result[s.id] = toArrayItems(result[s.id]);
      }
    }
  }

  return result as TemplateData;
}

// Every photoId referenced by a page's image slots, regardless of bracket paths.
export function collectPhotoIds(pages: AdaptablePage[]): string[] {
  const ids = new Set<string>();
  for (const page of pages) {
    for (const photoId of Object.values(page.images)) {
      if (photoId) ids.add(photoId);
    }
  }
  return [...ids];
}
