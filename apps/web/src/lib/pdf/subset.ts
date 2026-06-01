import { readFile } from 'node:fs/promises';
import subsetFont from 'subset-font';

// Full TTFs are ~7-10MB each; keep loaded buffers in module scope so repeated
// exports in the same warm lambda don't re-read disk (B31 known issue: fontkit
// cold start). subset() itself is fast once the buffer is in memory.
const fullFontCache = new Map<string, Buffer>();

async function loadFull(fontPath: string): Promise<Buffer> {
  const cached = fullFontCache.get(fontPath);
  if (cached) return cached;
  const buf = await readFile(fontPath);
  fullFontCache.set(fontPath, buf);
  return buf;
}

export async function subsetTtf(fontPath: string, charset: string): Promise<Buffer> {
  const full = await loadFull(fontPath);
  return subsetFont(full, charset, { targetFormat: 'truetype' });
}
