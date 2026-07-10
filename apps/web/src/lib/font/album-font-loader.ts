'use client';

import { useEffect, useState } from 'react';
import {
  collectAlbumFontRequest,
  type AlbumFontRequest,
  type AlbumFontRequestPage,
} from './album-font-request';
import type { CjkFontId } from '@/services/font/font-manifest';

interface FontSubsetPayload {
  sansBase64: string;
  serifBase64: string;
  artFonts: Partial<Record<CjkFontId, { family: string; base64: string }>>;
}

export interface AlbumFontFace {
  family: string;
  load(): Promise<AlbumFontFace>;
}

export interface AlbumFontEnvironment {
  fetchSubset(request: AlbumFontRequest): Promise<FontSubsetPayload>;
  createFontFace(family: string, source: string): AlbumFontFace;
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
    createFontFace(family, source) {
      return new FontFace(family, source, { style: 'normal', weight: '400' }) as AlbumFontFace;
    },
    addFontFace(face) {
      document.fonts.add(face as FontFace);
    },
    fontsReady() {
      return document.fonts.ready;
    },
  };
}

async function installSubset(
  request: AlbumFontRequest,
  env: AlbumFontEnvironment,
): Promise<void> {
  const subset = await env.fetchSubset(request);
  const families = new Map<string, string>([
    ['NotoSansSC', subset.sansBase64],
    ['NotoSerifSC', subset.serifBase64],
  ]);
  for (const font of Object.values(subset.artFonts ?? {})) {
    if (font) families.set(font.family, font.base64);
  }

  await Promise.all([...families].map(async ([family, base64]) => {
    const face = env.createFontFace(family, `url(data:font/ttf;base64,${base64})`);
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
