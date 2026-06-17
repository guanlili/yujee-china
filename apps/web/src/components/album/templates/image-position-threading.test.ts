import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

// #165: every WebImage/PdfImage call across all image-bearing templates must
// thread `position={imagePos?.[...]}`. This is a wide mechanical change; the
// test guards against a template silently dropping the override on refactor.

const here = dirname(fileURLToPath(import.meta.url));

function templateFiles(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(here, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!/^(mag-\d+|p\d+)$/.test(entry.name)) continue;
    for (const f of ['index.tsx', 'pdf.tsx']) {
      try {
        out.push(join(here, entry.name, f));
      } catch {
        /* missing variant */
      }
    }
  }
  return out;
}

test('every <WebImage>/<PdfImage> in a template threads a position prop', () => {
  const tagRe = /<(WebImage|PdfImage)\b([\s\S]*?)\/>/g;
  for (const file of templateFiles()) {
    let src: string;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(src)) !== null) {
      const attrs = m[2]!;
      assert.match(
        attrs,
        /position=\{imagePos\?\./,
        `${file}: a <${m[1]}> is missing position={imagePos?.[...]}`,
      );
    }
  }
});
