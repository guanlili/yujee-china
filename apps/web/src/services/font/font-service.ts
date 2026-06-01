import path from 'node:path';
import { subsetTtf } from '@/lib/pdf/subset';
import { logger } from '@/lib/log/logger';

// Server-only full fonts live in apps/web/fonts/ (not public/, so the browser
// can't fetch the ~17MB originals). On Vercel they're copied next to the
// lambda via next.config outputFileTracingIncludes, so process.cwd() resolves.
const FONTS_DIR = path.join(process.cwd(), 'fonts');
const SANS_PATH = path.join(FONTS_DIR, 'NotoSansSC-Regular.ttf');
const SERIF_PATH = path.join(FONTS_DIR, 'NotoSerifSC-Regular.ttf');

export const fontService = {
  // actor: caller's userId — auth + log attribution only (charset is glyphs, not
  // user data). NO per-user throttle here: app-wide rate limiting isn't built yet
  // (planned for the /api/v1/* layer, see docs/web/api.md §6). The CPU-heavy 2×
  // subset is bounded per-call by the route's charset≤5000 cap + Vercel's
  // function concurrency/timeout — acceptable at the 1000-user stage.
  async subset(actor: string, charset: string): Promise<{ sans: string; serif: string }> {
    logger.info({ actor, action: 'font.subset', charCount: charset.length });
    const [sans, serif] = await Promise.all([
      subsetTtf(SANS_PATH, charset),
      subsetTtf(SERIF_PATH, charset),
    ]);
    return { sans: sans.toString('base64'), serif: serif.toString('base64') };
  },
};
