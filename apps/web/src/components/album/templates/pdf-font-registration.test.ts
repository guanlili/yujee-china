import assert from 'node:assert/strict';
import test from 'node:test';
import { Font } from '@react-pdf/renderer';

import { registerPdfFonts, withRegisteredPdfFonts } from './pdf-utils';

interface RegisteredFamily {
  sources: Array<{ src: string }>;
  resolve(descriptor: { fontWeight: number; fontStyle: string }): { src: string };
}

function family(name: string): RegisteredFamily {
  const registered = Font.getRegisteredFonts() as unknown as Record<string, RegisteredFamily>;
  assert.ok(registered[name], `${name} must be registered`);
  return registered[name]!;
}

test('registerPdfFonts replaces dynamic sources between consecutive albums', () => {
  registerPdfFonts({
    sans: 'FIRST-SANS',
    serif: 'FIRST-SERIF',
    artFonts: { 'long-cang': { family: 'Long Cang', base64: 'FIRST-ART' } },
  });
  registerPdfFonts({
    sans: 'SECOND-SANS',
    serif: 'SECOND-SERIF',
    artFonts: { 'long-cang': { family: 'Long Cang', base64: 'SECOND-ART' } },
  });

  assert.equal(family('NotoSerifSC').sources.length, 5);
  assert.match(
    family('NotoSerifSC').resolve({ fontWeight: 400, fontStyle: 'normal' }).src,
    /SECOND-SERIF$/,
  );
  assert.equal(family('Long Cang').sources.length, 5);
  assert.match(
    family('Long Cang').resolve({ fontWeight: 400, fontStyle: 'normal' }).src,
    /SECOND-ART$/,
  );
  assert.equal(family('Inter').sources.length, 4, 'static Latin registrations must not accumulate');
  assert.ok(family('Courier'), 'selective replacement must preserve built-in fonts');
});

test('withRegisteredPdfFonts serializes global font-store use', async () => {
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

  const first = withRegisteredPdfFonts(
    { sans: 'A-SANS', serif: 'A-SERIF' },
    async () => {
      events.push('first:start');
      await firstGate;
      events.push('first:end');
      return 'first';
    },
  );
  const second = withRegisteredPdfFonts(
    { sans: 'B-SANS', serif: 'B-SERIF' },
    async () => {
      events.push('second:start');
      return 'second';
    },
  );

  await Promise.resolve();
  assert.deepEqual(events, ['first:start']);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start']);
});
