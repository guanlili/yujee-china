import path from 'node:path';
import { subsetTtf } from '@/lib/pdf/subset';
import { logger } from '@/lib/log/logger';
import {
  CJK_FONT_MANIFEST,
  isCjkFontId,
  type CjkFontId,
} from './font-manifest';

export { CJK_FONT_IDS } from './font-manifest';

// Server-only full fonts live in apps/web/fonts/ (not public/, so the browser
// can't fetch the ~17MB originals). On Vercel they're copied next to the
// lambda via next.config outputFileTracingIncludes, so process.cwd() resolves.
const FONTS_DIR = path.join(process.cwd(), 'fonts');
const MAX_ART_FONTS = 3;

type SubsetFn = (fontPath: string, charset: string) => Promise<Buffer>;

export interface SubsetFontBytes {
  sans: Buffer;
  serif: Buffer;
  artFonts: Partial<Record<CjkFontId, { family: string; bytes: Buffer }>>;
}

export interface SubsetFontResponse {
  sans: string;
  serif: string;
  artFonts: Partial<Record<CjkFontId, { family: string; base64: string }>>;
}

export async function subsetFontSet(
  charset: string,
  requestedIds: readonly CjkFontId[],
  subset: SubsetFn = subsetTtf,
): Promise<SubsetFontBytes> {
  for (const id of requestedIds as readonly string[]) {
    if (!isCjkFontId(id)) throw new Error(`unknown CJK font id: ${id}`);
  }
  const fontIds = [...new Set(requestedIds)];
  if (fontIds.length > MAX_ART_FONTS) {
    throw new Error(`at most ${MAX_ART_FONTS} CJK art fonts may be requested`);
  }

  const subsetById = new Map<CjkFontId, Promise<Buffer>>();
  const cut = (id: CjkFontId) => {
    const existing = subsetById.get(id);
    if (existing) return existing;
    const promise = subset(path.join(FONTS_DIR, CJK_FONT_MANIFEST[id].file), charset);
    subsetById.set(id, promise);
    return promise;
  };

  const sansPromise = cut('noto-sans-sc');
  const serifPromise = cut('noto-serif-sc');
  for (const id of fontIds) cut(id);

  const [sans, serif] = await Promise.all([sansPromise, serifPromise]);
  const artFonts: SubsetFontBytes['artFonts'] = {};
  await Promise.all(fontIds.map(async (id) => {
    artFonts[id] = {
      family: CJK_FONT_MANIFEST[id].family,
      bytes: await subsetById.get(id)!,
    };
  }));
  return { sans, serif, artFonts };
}

export const fontService = {
  // actor: caller's userId — auth + log attribution only (charset is glyphs, not
  // user data). NO per-user throttle here: app-wide rate limiting isn't built yet
  // (planned for the /api/v1/* layer, see docs/web/api.md §6). The CPU-heavy 2×
  // subset is bounded per-call by the route's charset≤5000 cap + Vercel's
  // function concurrency/timeout — acceptable at the 1000-user stage.
  async subset(
    actor: string,
    charset: string,
    fontIds: readonly CjkFontId[] = [],
  ): Promise<SubsetFontResponse> {
    logger.info({ actor, action: 'font.subset', charCount: charset.length, fontIds });
    const result = await subsetFontSet(charset, fontIds);
    const artFonts: SubsetFontResponse['artFonts'] = {};
    for (const [id, font] of Object.entries(result.artFonts) as [CjkFontId, { family: string; bytes: Buffer }][]) {
      artFonts[id] = { family: font.family, base64: font.bytes.toString('base64') };
    }
    return {
      sans: result.sans.toString('base64'),
      serif: result.serif.toString('base64'),
      artFonts,
    };
  },
};
