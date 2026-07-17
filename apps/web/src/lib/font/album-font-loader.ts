'use client';

import { useEffect, useState } from 'react';
import {
  collectAlbumFontRequest,
  type AlbumFontRequest,
  type AlbumFontRequestPage,
} from './album-font-request';
import {
  CJK_FONT_MANIFEST,
  isCjkFontId,
  type CjkFontId,
} from '@/services/font/font-manifest';

interface FontSubsetPayload {
  sansBase64: string;
  serifBase64: string;
  artFonts: Partial<Record<CjkFontId, { family: string; base64: string }>>;
}

export interface AlbumFontFace {
  family: string;
  load(): Promise<AlbumFontFace>;
}

export interface AlbumFontFaceDescriptors {
  unicodeRange: string;
}

export interface AlbumFontEnvironment {
  fetchSubset(request: AlbumFontRequest): Promise<FontSubsetPayload>;
  createFontFace(
    family: string,
    source: string,
    descriptors: AlbumFontFaceDescriptors,
  ): AlbumFontFace;
  addFontFace(face: AlbumFontFace): void;
  fontsReady(): Promise<unknown>;
}

const loadCache = new Map<string, Promise<void>>();

function requestKey(request: AlbumFontRequest): string {
  return JSON.stringify([request.fontIds, request.charset]);
}

function browserEnvironment(): AlbumFontEnvironment {
  return {
    async fetchSubset(request) {
      const response = await fetch('/api/v1/fonts/subset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error?.message ?? 'font subset failed');
      }
      return json.data as FontSubsetPayload;
    },
    createFontFace(family, source, descriptors) {
      return new FontFace(family, source, {
        style: 'normal',
        weight: '400',
        unicodeRange: descriptors.unicodeRange,
      }) as AlbumFontFace;
    },
    addFontFace(face) {
      document.fonts.add(face as FontFace);
    },
    fontsReady() {
      return document.fonts.ready;
    },
  };
}

export function unicodeRangeForCharset(charset: string): string {
  const points = [...new Set([...charset].map((char) => char.codePointAt(0)!))]
    .sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let index = 0; index < points.length;) {
    const start = points[index]!;
    let end = start;
    while (index + 1 < points.length && points[index + 1] === end + 1) {
      index += 1;
      end = points[index]!;
    }
    const from = start.toString(16).toUpperCase();
    const to = end.toString(16).toUpperCase();
    ranges.push(start === end ? `U+${from}` : `U+${from}-${to}`);
    index += 1;
  }
  return ranges.join(', ');
}

async function installSubset(
  request: AlbumFontRequest,
  env: AlbumFontEnvironment,
): Promise<void> {
  const subset = await env.fetchSubset(request);
  const descriptors = { unicodeRange: unicodeRangeForCharset(request.charset) };
  const families = new Map<string, string>([
    [CJK_FONT_MANIFEST['noto-sans-sc'].webFamily, subset.sansBase64],
    [CJK_FONT_MANIFEST['noto-serif-sc'].webFamily, subset.serifBase64],
  ]);
  for (const [id, font] of Object.entries(subset.artFonts ?? {})) {
    if (font && isCjkFontId(id)) {
      families.set(CJK_FONT_MANIFEST[id].webFamily, font.base64);
    }
  }

  await Promise.all([...families].map(async ([family, base64]) => {
    const face = env.createFontFace(
      family,
      `url(data:font/ttf;base64,${base64})`,
      descriptors,
    );
    const loaded = await face.load();
    env.addFontFace(loaded);
  }));
  await env.fontsReady();
}

export function loadAlbumFonts(
  pages: readonly AlbumFontRequestPage[],
  env: AlbumFontEnvironment = browserEnvironment(),
): Promise<void> {
  const request = collectAlbumFontRequest(pages);
  return loadFontSubset(request, env);
}

// 按需子集化:编辑器字体选择器给中文艺术字做「预览串子集」与「选中后按正文子集」
// 时直接传一个 {fontIds, charset} 请求(不经 page 收集)。与 loadAlbumFonts 共用同一
// 去重缓存,重复请求零成本。
export function loadFontSubset(
  request: AlbumFontRequest,
  env: AlbumFontEnvironment = browserEnvironment(),
): Promise<void> {
  if (request.fontIds.length === 0 || request.charset.length === 0) return Promise.resolve();
  const key = requestKey(request);
  const existing = loadCache.get(key);
  if (existing) return existing;

  const pending = installSubset(request, env).catch((error) => {
    loadCache.delete(key);
    throw error;
  });
  loadCache.set(key, pending);
  return pending;
}

export function useAlbumFonts(pages: readonly AlbumFontRequestPage[]): boolean {
  const request = collectAlbumFontRequest(pages);
  const key = requestKey(request);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    setReady(false);
    void loadAlbumFonts(pages).then(
      () => { if (active) setReady(true); },
      () => { if (active) setReady(false); },
    );
    return () => { active = false; };
    // `key` represents all font-relevant content; page object identity is noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return ready;
}

export function clearAlbumFontLoadCacheForTests(): void {
  loadCache.clear();
}
