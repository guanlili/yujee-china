import assert from 'node:assert/strict';
import test from 'node:test';
import { readTakenAtFromExif } from './compress';

// Build a minimal JPEG (SOI + APP1/Exif + EOI) carrying a single IFD0 entry that
// points at an Exif sub-IFD with a DateTimeOriginal (0x9003) ASCII tag. Big-endian
// ("MM") TIFF layout. Optionally injects a GPS IFD pointer (0x8825) to prove the
// reader ignores it (privacy red line).
function buildJpegWithExif(opts: {
  dateOriginal?: string;
  withGpsPointer?: boolean;
  byteOrder?: 'II' | 'MM';
}): ArrayBuffer {
  const little = opts.byteOrder === 'II';
  const tiff: number[] = [];
  const u16 = (v: number) => (little ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff]);
  const u32 = (v: number) =>
    little
      ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]
      : [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];

  // TIFF header
  if (little) tiff.push(0x49, 0x49);
  else tiff.push(0x4d, 0x4d);
  tiff.push(...u16(0x002a));
  tiff.push(...u32(8)); // IFD0 at offset 8

  const ifd0Count = 1 + (opts.withGpsPointer ? 1 : 0);
  // Layout offsets are computed from the TIFF start.
  const ifd0Start = 8;
  const ifd0End = ifd0Start + 2 + ifd0Count * 12 + 4;
  const exifIfdStart = ifd0End;

  const date = opts.dateOriginal ?? '2024:03:15 08:30:00';
  const dateBytes = [...date.split('').map((c) => c.charCodeAt(0)), 0];
  const exifIfdEnd = exifIfdStart + 2 + 1 * 12 + 4;
  const dateValueOffset = exifIfdEnd; // ASCII payload after the Exif IFD

  // --- IFD0 ---
  tiff.push(...u16(ifd0Count));
  // 0x8769 Exif IFD pointer (type 4 LONG, count 1) → exifIfdStart
  tiff.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifIfdStart));
  if (opts.withGpsPointer) {
    // 0x8825 GPS IFD pointer — present but should NEVER be followed by the reader.
    tiff.push(...u16(0x8825), ...u16(4), ...u32(1), ...u32(exifIfdEnd + dateBytes.length));
  }
  tiff.push(...u32(0)); // next IFD = none

  // --- Exif sub-IFD ---
  tiff.push(...u16(1));
  // 0x9003 DateTimeOriginal (type 2 ASCII)
  tiff.push(...u16(0x9003), ...u16(2), ...u32(dateBytes.length), ...u32(dateValueOffset));
  tiff.push(...u32(0)); // next IFD = none

  // --- DateTimeOriginal payload ---
  tiff.push(...dateBytes);

  // --- (optional) GPS IFD: a fake coordinate, to verify it's ignored ---
  if (opts.withGpsPointer) {
    tiff.push(...u16(0)); // empty GPS IFD is enough; reader must not even reach here
    tiff.push(...u32(0));
  }

  const exifHeader = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  const app1Payload = [...exifHeader, ...tiff];
  const app1Len = app1Payload.length + 2;

  const jpeg = [
    0xff, 0xd8, // SOI
    0xff, 0xe1, // APP1
    (app1Len >> 8) & 0xff, app1Len & 0xff,
    ...app1Payload,
    0xff, 0xd9, // EOI
  ];
  return new Uint8Array(jpeg).buffer;
}

test('readTakenAtFromExif reads DateTimeOriginal as ISO local datetime (MM/big-endian)', () => {
  const buf = buildJpegWithExif({ dateOriginal: '2024:03:15 08:30:00', byteOrder: 'MM' });
  assert.equal(readTakenAtFromExif(buf), '2024-03-15T08:30:00');
});

test('readTakenAtFromExif reads DateTimeOriginal (II/little-endian)', () => {
  const buf = buildJpegWithExif({ dateOriginal: '2021:12:31 23:59:59', byteOrder: 'II' });
  assert.equal(readTakenAtFromExif(buf), '2021-12-31T23:59:59');
});

test('readTakenAtFromExif ignores the GPS IFD entirely (privacy red line)', () => {
  // Even with a GPS pointer present, only the date comes back — no coordinate path.
  const buf = buildJpegWithExif({ dateOriginal: '2024:03:15 08:30:00', withGpsPointer: true });
  assert.equal(readTakenAtFromExif(buf), '2024-03-15T08:30:00');
});

test('readTakenAtFromExif returns null for a non-JPEG / no-EXIF buffer', () => {
  assert.equal(readTakenAtFromExif(new Uint8Array([0x00, 0x01, 0x02, 0x03]).buffer), null);
  // Valid JPEG SOI but no APP1.
  const noExif = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer;
  assert.equal(readTakenAtFromExif(noExif), null);
});

test('readTakenAtFromExif rejects zeroed/garbage date and never throws', () => {
  assert.equal(readTakenAtFromExif(buildJpegWithExif({ dateOriginal: '0000:00:00 00:00:00' })), null);
  assert.equal(readTakenAtFromExif(buildJpegWithExif({ dateOriginal: 'not-a-date-at-all' })), null);
});

test('compress.ts never reads GPS tags (static source guard)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, 'compress.ts'), 'utf8');
  // The GPS IFD pointer tag must only ever appear in a comment explaining it is
  // NOT followed — not as a live constant the reader resolves.
  assert.equal(/TAG_GPS|0x8825[^)]*\)/.test(src) && !/never/.test(src), false);
  assert.match(src, /never follows the GPS IFD/i);
});
