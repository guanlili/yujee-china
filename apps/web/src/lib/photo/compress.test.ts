import assert from 'node:assert/strict';
import test from 'node:test';
import { compressFile, readGeoForClustering, readTakenAtFromExif } from './compress';

type Gps = { lat: [number, number, number]; latRef: string; lng: [number, number, number]; lngRef: string };

// Build a minimal JPEG (SOI + APP1/Exif + EOI) carrying a single IFD0 entry that
// points at an Exif sub-IFD with a DateTimeOriginal (0x9003) ASCII tag. Big-endian
// ("MM") TIFF layout by default. Optionally injects a real GPS IFD (0x8825) with
// lat/lng rationals so we can assert (a) takenAt reader ignores GPS and (b) the
// dedicated GPS reader parses it for in-memory clustering only.
function buildJpegWithExif(opts: {
  dateOriginal?: string;
  withGpsPointer?: boolean;
  gps?: Gps;
  byteOrder?: 'II' | 'MM';
}): ArrayBuffer {
  const little = opts.byteOrder === 'II';
  const tiff: number[] = [];
  const u16 = (v: number) => (little ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff]);
  const u32 = (v: number) =>
    little
      ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]
      : [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];

  const hasGps = opts.withGpsPointer || !!opts.gps;
  const gps: Gps = opts.gps ?? { lat: [40, 30, 0], latRef: 'N', lng: [74, 0, 0], lngRef: 'W' };

  // TIFF header
  if (little) tiff.push(0x49, 0x49);
  else tiff.push(0x4d, 0x4d);
  tiff.push(...u16(0x002a));
  tiff.push(...u32(8)); // IFD0 at offset 8

  const ifd0Count = 1 + (hasGps ? 1 : 0);
  // Layout offsets are computed from the TIFF start.
  const ifd0Start = 8;
  const ifd0End = ifd0Start + 2 + ifd0Count * 12 + 4;
  const exifIfdStart = ifd0End;

  const date = opts.dateOriginal ?? '2024:03:15 08:30:00';
  const dateBytes = [...date.split('').map((c) => c.charCodeAt(0)), 0];
  const exifIfdEnd = exifIfdStart + 2 + 1 * 12 + 4;
  const dateValueOffset = exifIfdEnd; // ASCII payload after the Exif IFD

  // GPS IFD layout (only when present): 4 tags (latRef, lat, lngRef, lng) + next.
  const gpsIfdStart = dateValueOffset + dateBytes.length;
  const gpsIfdEnd = gpsIfdStart + 2 + 4 * 12 + 4;
  // Out-of-line rational payloads: 3 rationals (24 bytes) each for lat then lng.
  const latPayloadOffset = gpsIfdEnd;
  const lngPayloadOffset = latPayloadOffset + 24;

  // --- IFD0 ---
  tiff.push(...u16(ifd0Count));
  // 0x8769 Exif IFD pointer (type 4 LONG, count 1) → exifIfdStart
  tiff.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifIfdStart));
  if (hasGps) {
    // 0x8825 GPS IFD pointer → gpsIfdStart
    tiff.push(...u16(0x8825), ...u16(4), ...u32(1), ...u32(gpsIfdStart));
  }
  tiff.push(...u32(0)); // next IFD = none

  // --- Exif sub-IFD ---
  tiff.push(...u16(1));
  // 0x9003 DateTimeOriginal (type 2 ASCII)
  tiff.push(...u16(0x9003), ...u16(2), ...u32(dateBytes.length), ...u32(dateValueOffset));
  tiff.push(...u32(0)); // next IFD = none

  // --- DateTimeOriginal payload ---
  tiff.push(...dateBytes);

  // --- (optional) GPS IFD with real lat/lng rationals ---
  if (hasGps) {
    const refInline = (ch: string) => {
      // Full IFD entry tail for an ASCII ref tag: type(2)=ASCII, count(4)=2,
      // value(4) inline = "X\0" + padding.
      return [...u16(2), ...u32(2), ch.charCodeAt(0), 0, 0, 0];
    };
    tiff.push(...u16(4));
    // 0x0001 GPSLatitudeRef (ASCII, count 2, inline)
    tiff.push(...u16(0x0001), ...refInline(gps.latRef));
    // 0x0002 GPSLatitude (RATIONAL type 5, count 3, out-of-line)
    tiff.push(...u16(0x0002), ...u16(5), ...u32(3), ...u32(latPayloadOffset));
    // 0x0003 GPSLongitudeRef (ASCII, count 2, inline)
    tiff.push(...u16(0x0003), ...refInline(gps.lngRef));
    // 0x0004 GPSLongitude (RATIONAL type 5, count 3, out-of-line)
    tiff.push(...u16(0x0004), ...u16(5), ...u32(3), ...u32(lngPayloadOffset));
    tiff.push(...u32(0)); // next IFD = none
    // lat then lng rational payloads (num/den pairs; den = 1)
    for (const v of gps.lat) tiff.push(...u32(v), ...u32(1));
    for (const v of gps.lng) tiff.push(...u32(v), ...u32(1));
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

test('readTakenAtFromExif returns ONLY the date even when GPS is present (no coord path)', () => {
  // readTakenAtFromExif must never surface a coordinate: with a full GPS IFD present
  // it still returns a plain datetime string, nothing else.
  const buf = buildJpegWithExif({ dateOriginal: '2024:03:15 08:30:00', withGpsPointer: true });
  assert.equal(readTakenAtFromExif(buf), '2024-03-15T08:30:00');
});

test('readGeoForClustering parses N/W GPS into signed decimal degrees', () => {
  // 40°30′00″N, 74°00′00″W → (40.5, -74)
  const buf = buildJpegWithExif({
    gps: { lat: [40, 30, 0], latRef: 'N', lng: [74, 0, 0], lngRef: 'W' },
  });
  const geo = readGeoForClustering(buf);
  assert.ok(geo);
  assert.ok(Math.abs(geo!.lat - 40.5) < 1e-9);
  assert.ok(Math.abs(geo!.lng - -74) < 1e-9);
});

test('readGeoForClustering applies S/E ref signs (little-endian)', () => {
  // 33°30′00″S, 151°00′00″E → (-33.5, 151)
  const buf = buildJpegWithExif({
    byteOrder: 'II',
    gps: { lat: [33, 30, 0], latRef: 'S', lng: [151, 0, 0], lngRef: 'E' },
  });
  const geo = readGeoForClustering(buf);
  assert.ok(geo);
  assert.ok(Math.abs(geo!.lat - -33.5) < 1e-9);
  assert.ok(Math.abs(geo!.lng - 151) < 1e-9);
});

test('readGeoForClustering returns null when no GPS IFD is present', () => {
  const buf = buildJpegWithExif({ dateOriginal: '2024:03:15 08:30:00' });
  assert.equal(readGeoForClustering(buf), null);
  // And for a non-JPEG buffer.
  assert.equal(readGeoForClustering(new Uint8Array([0x00, 0x01]).buffer), null);
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

test('compress.ts confines GPS to the clustering reader (static privacy guard)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, 'compress.ts'), 'utf8');

  // GPS may now be read — but ONLY by readGeoForClustering, returning a transient
  // ClusterGeo. The privacy invariant comment must be present and explicit.
  assert.match(src, /readGeoForClustering/);
  assert.match(src, /never leave the browser/i);
  // CompressedPhoto must NOT expose raw lat/lng keys — only the transient clusterGeo.
  assert.equal(/^\s*lat\s*[:?]/m.test(src), false);
  assert.equal(/^\s*lng\s*[:?]/m.test(src), false);
});

test('compressFile decodes via a Blob object URL instead of a full-size data URL', async () => {
  const globals = globalThis as Record<string, unknown>;
  const original = {
    FileReader: globals.FileReader,
    Image: globals.Image,
    document: globals.document,
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };

  const seen: {
    src?: string;
    revoked?: string;
    draw?: { width: number; height: number };
    output?: { type: string; quality: number };
  } = {};

  class FakeFileReader {
    result: ArrayBuffer | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    error: Error | null = null;
    readAsArrayBuffer() {
      this.result = new Uint8Array([0, 1, 2, 3]).buffer;
      queueMicrotask(() => this.onload?.());
    }
  }

  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 1600;
    height = 1200;
    set src(value: string) {
      seen.src = value;
      queueMicrotask(() => this.onload?.());
    }
  }

  try {
    globals.FileReader = FakeFileReader;
    globals.Image = FakeImage;
    globals.document = {
      createElement(tag: string) {
        assert.equal(tag, 'canvas');
        return {
          width: 0,
          height: 0,
          getContext(type: string) {
            assert.equal(type, '2d');
            return {
              drawImage(_img: unknown, _x: number, _y: number, width: number, height: number) {
                seen.draw = { width, height };
              },
            };
          },
          toDataURL(type: string, quality: number) {
            seen.output = { type, quality };
            return 'data:image/jpeg;base64,compressed';
          },
        };
      },
    };
    URL.createObjectURL = (() => 'blob:yujee-photo') as typeof URL.createObjectURL;
    URL.revokeObjectURL = ((url: string) => {
      seen.revoked = url;
    }) as typeof URL.revokeObjectURL;

    const photo = await compressFile({ type: 'image/jpeg' } as Blob, 'photo-1');

    assert.equal(seen.src, 'blob:yujee-photo');
    assert.equal(seen.revoked, 'blob:yujee-photo');
    assert.deepEqual(seen.draw, { width: 800, height: 600 });
    assert.deepEqual(seen.output, { type: 'image/jpeg', quality: 0.6 });
    assert.equal(photo.base64, 'data:image/jpeg;base64,compressed');
    assert.equal(photo.width, 800);
    assert.equal(photo.height, 600);
    assert.equal(photo.takenAt, null);
    assert.equal(photo.clusterGeo, null);
  } finally {
    globals.FileReader = original.FileReader;
    globals.Image = original.Image;
    globals.document = original.document;
    URL.createObjectURL = original.createObjectURL;
    URL.revokeObjectURL = original.revokeObjectURL;
  }
});

test('compressFile reports an actionable decode error when the browser cannot read an image', async () => {
  const globals = globalThis as Record<string, unknown>;
  const original = {
    FileReader: globals.FileReader,
    Image: globals.Image,
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };

  class FakeFileReader {
    result: ArrayBuffer | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    error: Error | null = null;
    readAsArrayBuffer() {
      this.result = new Uint8Array([0, 1, 2, 3]).buffer;
      queueMicrotask(() => this.onload?.());
    }
  }

  class BrokenImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => this.onerror?.());
    }
  }

  try {
    globals.FileReader = FakeFileReader;
    globals.Image = BrokenImage;
    URL.createObjectURL = (() => 'blob:unsupported-photo') as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;

    await assert.rejects(
      () => compressFile({ type: 'image/heic' } as Blob, 'photo-1'),
      /could not decode this image/i,
    );
  } finally {
    globals.FileReader = original.FileReader;
    globals.Image = original.Image;
    URL.createObjectURL = original.createObjectURL;
    URL.revokeObjectURL = original.revokeObjectURL;
  }
});
