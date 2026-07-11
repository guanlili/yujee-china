'use client';

import type { ClusterGeo } from './cluster';
import { prepareImageBlobForBrowserDecode, type HeicConverter } from './heic';

export type CompressedPhoto = {
  photoId: string;
  base64: string;
  width: number;
  height: number;
  // EXIF capture time (ISO 8601), used as a deterministic chaptering signal by the
  // Agent. `null` when the file carries no readable EXIF DateTime. PRIVACY (D-GPS,
  // architecture §3): this is the ONLY EXIF field that ever rides on the photo object
  // — see `clusterGeo` below for why GPS does NOT.
  takenAt: string | null;
  // PRIVACY (#232 / architecture §3 carve-out): transient EXIF GPS, used ONLY by the
  // browser's in-memory spatio-temporal clustering to derive an opaque `clusterId`.
  // It is NOT part of `GenerationPhoto`, so it never reaches the request body, a log,
  // or IndexedDB. Callers must read it for clustering and then DROP it — never spread
  // it into the payload sent to `/v3/analyze`. `null` when the file carries no GPS.
  clusterGeo: ClusterGeo | null;
};

type CompressOptions = {
  maxLen?: number;
  quality?: number;
  heicConverter?: HeicConverter;
};

// Accepts a Blob (File is a Blob) so we can re-compress originals read back from
// IndexedDB — the resume-after-purchase and failed-album retry flows rebuild the
// 800px base64 from the stored original instead of persisting the base64 itself.
export async function compressFile(
  file: Blob,
  photoId: string,
  options: CompressOptions = {},
): Promise<CompressedPhoto> {
  const bytes = await readAsArrayBuffer(file);
  const takenAt = readTakenAtFromExif(bytes);
  const clusterGeo = readGeoForClustering(bytes);
  const decodeFile = await prepareImageBlobForBrowserDecode(file, options.heicConverter);
  const img = await loadImage(decodeFile);
  const { canvas, w, h } = drawScaled(img, options.maxLen ?? 800);
  const base64 = canvas.toDataURL('image/jpeg', options.quality ?? 0.6);
  return { photoId, base64, width: w, height: h, takenAt, clusterGeo };
}

function readAsArrayBuffer(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(fr.error ?? new Error('Browser could not read this image file.'));
    fr.readAsArrayBuffer(file);
  });
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(src);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(src);
      reject(
        new Error(
          'Browser could not decode this image for compression. Please choose a JPEG, PNG, WebP, or HEIC/HEIF image.',
        ),
      );
    };
    img.src = src;
  });
}

function drawScaled(img: HTMLImageElement, maxLen: number) {
  const scale = Math.min(1, maxLen / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, w, h };
}

// --- EXIF parser (takenAt + GPS-for-clustering ONLY) ------------------------
//
// Minimal, dependency-free EXIF parser for both containers the pickers hand us:
// JPEG (APP1 segment) and HEIC/HEIF ('Exif' metadata item — iPhone default).
// It walks the TIFF IFD0 + Exif sub-IFD and returns the capture timestamp from
// one of three tags:
//   - 0x9003 DateTimeOriginal   (preferred)
//   - 0x9004 DateTimeDigitized  (fallback)
//   - 0x0132 DateTime           (fallback)
//
// PRIVACY (#232 / architecture §3 carve-out): it ALSO reads the GPS IFD (tag
// 0x8825) — but ONLY via `readGeoForClustering`, which returns a transient
// {lat,lng} consumed in-memory by spatio-temporal clustering to derive an opaque
// `clusterId`. The coordinates NEVER leave the browser: they are not attached to
// `GenerationPhoto`, never serialised into the `/v3/analyze` body, never logged,
// never persisted. `readTakenAtFromExif` still never touches GPS.

const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_GPS_IFD_POINTER = 0x8825;
const TAG_DATETIME = 0x0132;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME_DIGITIZED = 0x9004;

// GPS IFD tags.
const TAG_GPS_LAT_REF = 0x0001; // 'N' | 'S'
const TAG_GPS_LAT = 0x0002; // 3 rationals: deg, min, sec
const TAG_GPS_LNG_REF = 0x0003; // 'E' | 'W'
const TAG_GPS_LNG = 0x0004; // 3 rationals: deg, min, sec

export function readTakenAtFromExif(bytes: ArrayBuffer): string | null {
  try {
    const view = new DataView(bytes);
    const tiffStart = findExifTiffStart(view);
    return tiffStart === null ? null : readDateFromTiff(view, tiffStart);
  } catch {
    return null; // any malformed EXIF → treat as no timestamp, never throw
  }
}

// Locates the EXIF TIFF header in either container format the photo pickers
// hand us: JPEG (APP1 segment) or HEIC/HEIF (ISO BMFF 'Exif' metadata item —
// iPhone default since iOS 11). Returns null when the container carries no EXIF.
function findExifTiffStart(view: DataView): number | null {
  if (view.byteLength >= 4 && view.getUint16(0) === 0xffd8) return findExifTiffStartInJpeg(view);
  return findExifTiffStartInHeif(view);
}

// JPEG: walk segments for the APP1 (0xFFE1) carrying the "Exif\0\0" header.
function findExifTiffStartInJpeg(view: DataView): number | null {
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xda) break; // start of scan — no metadata beyond here
    const segLen = view.getUint16(offset + 2);
    if (segLen < 2) break;
    if (marker === 0xe1) {
      if (
        offset + 4 + 6 <= view.byteLength &&
        view.getUint32(offset + 4) === 0x45786966 && // "Exif"
        view.getUint16(offset + 8) === 0x0000
      ) {
        return offset + 4 + 6; // skip "Exif\0\0"
      }
    }
    offset += 2 + segLen;
  }
  return null;
}

// --- HEIF (ISO BMFF) EXIF item locator ---------------------------------------
//
// HEIC photos store EXIF as a metadata item, not a JPEG segment:
//   meta → iinf/infe (find the item_ID whose item_type is 'Exif')
//   meta → iloc      (that item's absolute file offset)
//   payload = ExifDataBlock: [u32 exif_tiff_header_offset][…usually "Exif\0\0"][TIFF]
// Only construction_method 0 (file offset) and data_reference 0 (this file) are
// handled — that is what Apple and libheif emit for photos. Anything unexpected
// returns null; callers already treat null as "no EXIF".

const FOURCC_FTYP = 0x66747970;
const FOURCC_META = 0x6d657461;
const FOURCC_IINF = 0x69696e66;
const FOURCC_ILOC = 0x696c6f63;
const FOURCC_INFE = 0x696e6665;
const FOURCC_EXIF = 0x45786966;

function findExifTiffStartInHeif(view: DataView): number | null {
  if (view.byteLength < 12 || view.getUint32(4) !== FOURCC_FTYP) return null;
  const meta = findBmffBox(view, 0, view.byteLength, FOURCC_META);
  if (!meta) return null;
  const content = meta.start + 4; // skip FullBox version/flags
  const iinf = findBmffBox(view, content, meta.end, FOURCC_IINF);
  const iloc = findBmffBox(view, content, meta.end, FOURCC_ILOC);
  if (!iinf || !iloc) return null;
  const exifItemId = findHeifExifItemId(view, iinf);
  if (exifItemId === null) return null;
  const itemPos = findHeifItemOffset(view, iloc, exifItemId);
  if (itemPos === null || itemPos + 4 > view.byteLength) return null;
  const tiffStart = itemPos + 4 + view.getUint32(itemPos);
  return tiffStart + 8 <= view.byteLength ? tiffStart : null;
}

function findBmffBox(
  view: DataView,
  start: number,
  end: number,
  type: number,
): { start: number; end: number } | null {
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    let header = 8;
    if (size === 1) {
      // 64-bit largesize; >4GB unsupported (photos never are).
      if (offset + 16 > end || view.getUint32(offset + 8) !== 0) return null;
      size = view.getUint32(offset + 12);
      header = 16;
    } else if (size === 0) {
      size = end - offset; // box extends to end of enclosing scope
    }
    if (size < header || offset + size > end) return null;
    if (view.getUint32(offset + 4) === type) return { start: offset + header, end: offset + size };
    offset += size;
  }
  return null;
}

function findHeifExifItemId(view: DataView, iinf: { start: number; end: number }): number | null {
  const version = view.getUint8(iinf.start);
  let offset = iinf.start + 4;
  const count = version === 0 ? view.getUint16(offset) : view.getUint32(offset);
  offset += version === 0 ? 2 : 4;
  for (let i = 0; i < count && offset + 8 <= iinf.end; i++) {
    let size = view.getUint32(offset);
    if (size === 0) size = iinf.end - offset;
    if (size < 8 || offset + size > iinf.end) return null;
    if (view.getUint32(offset + 4) === FOURCC_INFE) {
      const v = view.getUint8(offset + 8);
      if (v >= 2) {
        // infe v2: item_ID u16 / v3: u32, then protection u16, then item_type 4cc.
        const idSize = v === 2 ? 2 : 4;
        const base = offset + 12;
        const itemId = v === 2 ? view.getUint16(base) : view.getUint32(base);
        if (view.getUint32(base + idSize + 2) === FOURCC_EXIF) return itemId;
      }
    }
    offset += size;
  }
  return null;
}

function findHeifItemOffset(
  view: DataView,
  iloc: { start: number; end: number },
  itemId: number,
): number | null {
  const version = view.getUint8(iloc.start);
  let offset = iloc.start + 4;
  const offsetSize = view.getUint8(offset) >> 4;
  const lengthSize = view.getUint8(offset) & 0xf;
  const baseOffsetSize = view.getUint8(offset + 1) >> 4;
  const indexSize = version === 1 || version === 2 ? view.getUint8(offset + 1) & 0xf : 0;
  offset += 2;
  let count: number;
  if (version < 2) {
    count = view.getUint16(offset);
    offset += 2;
  } else {
    count = view.getUint32(offset);
    offset += 4;
  }
  // Reads a 0/4/8-byte unsigned field; 8-byte values above 2^32 are rejected.
  const readSized = (pos: number, n: number): number | null => {
    if (n === 0) return 0;
    if (n === 4) return view.getUint32(pos);
    if (n === 8) return view.getUint32(pos) === 0 ? view.getUint32(pos + 4) : null;
    return null;
  };
  for (let i = 0; i < count; i++) {
    let id: number;
    if (version < 2) {
      id = view.getUint16(offset);
      offset += 2;
    } else {
      id = view.getUint32(offset);
      offset += 4;
    }
    let constructionMethod = 0;
    if (version === 1 || version === 2) {
      constructionMethod = view.getUint16(offset) & 0xf;
      offset += 2;
    }
    const dataReferenceIndex = view.getUint16(offset);
    offset += 2;
    const baseOffset = readSized(offset, baseOffsetSize);
    offset += baseOffsetSize;
    const extentCount = view.getUint16(offset);
    offset += 2;
    if (id === itemId) {
      if (constructionMethod !== 0 || dataReferenceIndex !== 0 || extentCount < 1) return null;
      const extentOffset = readSized(offset + indexSize, offsetSize);
      if (baseOffset === null || extentOffset === null) return null;
      return baseOffset + extentOffset;
    }
    offset += extentCount * (indexSize + offsetSize + lengthSize);
  }
  return null;
}

function readDateFromTiff(view: DataView, tiffStart: number): string | null {
  if (tiffStart + 8 > view.byteLength) return null;
  const byteOrder = view.getUint16(tiffStart);
  const little = byteOrder === 0x4949; // "II" little-endian; "MM" => big-endian
  if (!little && byteOrder !== 0x4d4d) return null;

  const u16 = (o: number) => view.getUint16(o, little);
  const u32 = (o: number) => view.getUint32(o, little);

  const ifd0Offset = tiffStart + u32(tiffStart + 4);

  // IFD0: read DateTime, and the Exif sub-IFD pointer (which holds the
  // higher-fidelity DateTimeOriginal/Digitized). GPS pointer is never read.
  const ifd0 = readIfd(view, tiffStart, ifd0Offset, little, u16, u32);

  let result: string | null = null;
  if (ifd0.has(TAG_EXIF_IFD_POINTER)) {
    const exifIfd = readIfd(view, tiffStart, tiffStart + ifd0.get(TAG_EXIF_IFD_POINTER)!.valueOffset, little, u16, u32);
    result =
      readAsciiTag(view, exifIfd, TAG_DATETIME_ORIGINAL, tiffStart, little, u32) ??
      readAsciiTag(view, exifIfd, TAG_DATETIME_DIGITIZED, tiffStart, little, u32);
  }
  if (!result) result = readAsciiTag(view, ifd0, TAG_DATETIME, tiffStart, little, u32);
  return result ? exifDateToIso(result) : null;
}

// Reads EXIF GPS into a transient {lat,lng} for in-browser clustering ONLY.
// Mirrors the APP1/EXIF walk of `readTakenAtFromExif`, then follows the GPS IFD
// pointer (0x8825). The returned coordinate is consumed by the clustering pass to
// derive an opaque `clusterId` and is then dropped — it must NEVER be attached to
// any payload, log, or persistence (architecture §3 / #232). Returns `null` for
// no-GPS / malformed EXIF; never throws.
export function readGeoForClustering(bytes: ArrayBuffer): ClusterGeo | null {
  try {
    const view = new DataView(bytes);
    const tiffStart = findExifTiffStart(view);
    return tiffStart === null ? null : readGeoFromTiff(view, tiffStart);
  } catch {
    return null; // malformed EXIF → treat as no GPS, never throw
  }
}

function readGeoFromTiff(view: DataView, tiffStart: number): ClusterGeo | null {
  if (tiffStart + 8 > view.byteLength) return null;
  const byteOrder = view.getUint16(tiffStart);
  const little = byteOrder === 0x4949;
  if (!little && byteOrder !== 0x4d4d) return null;

  const u16 = (o: number) => view.getUint16(o, little);
  const u32 = (o: number) => view.getUint32(o, little);

  const ifd0 = readIfd(view, tiffStart, tiffStart + u32(tiffStart + 4), little, u16, u32);
  const gpsPtr = ifd0.get(TAG_GPS_IFD_POINTER);
  if (!gpsPtr) return null;

  const gps = readIfd(view, tiffStart, tiffStart + gpsPtr.valueOffset, little, u16, u32);
  const lat = readGpsCoord(view, gps, TAG_GPS_LAT, TAG_GPS_LAT_REF, tiffStart, little);
  const lng = readGpsCoord(view, gps, TAG_GPS_LNG, TAG_GPS_LNG_REF, tiffStart, little);
  if (lat === null || lng === null) return null;
  return { lat, lng };
}

// Reads a GPS coordinate: three RATIONALs (deg, min, sec) + a ref char (N/S/E/W).
// Returns signed decimal degrees, or null if absent/malformed.
function readGpsCoord(
  view: DataView,
  gps: Map<number, IfdEntry>,
  coordTag: number,
  refTag: number,
  tiffStart: number,
  little: boolean,
): number | null {
  const entry = gps.get(coordTag);
  if (!entry || entry.type !== 5 || entry.count < 3) return null; // type 5 = RATIONAL
  const base = tiffStart + entry.valueOffset; // 3 rationals = 24 bytes, always out-of-line
  if (base + 24 > view.byteLength) return null;

  const rational = (i: number): number | null => {
    const num = view.getUint32(base + i * 8, little);
    const den = view.getUint32(base + i * 8 + 4, little);
    if (den === 0) return null;
    return num / den;
  };
  const deg = rational(0);
  const min = rational(1);
  const sec = rational(2);
  if (deg === null || min === null || sec === null) return null;

  let value = deg + min / 60 + sec / 3600;
  if (!Number.isFinite(value)) return null;

  const ref = readAsciiTag(view, gps, refTag, tiffStart, little, (o) => view.getUint32(o, little));
  if (ref === 'S' || ref === 'W') value = -value;
  if (Math.abs(value) > 180) return null; // out-of-range guard
  return value;
}

type IfdEntry = { type: number; count: number; valueOffset: number; valuePos: number };

function readIfd(
  view: DataView,
  tiffStart: number,
  ifdOffset: number,
  _little: boolean,
  u16: (o: number) => number,
  u32: (o: number) => number,
): Map<number, IfdEntry> {
  const entries = new Map<number, IfdEntry>();
  if (ifdOffset + 2 > view.byteLength) return entries;
  const count = u16(ifdOffset);
  for (let i = 0; i < count; i++) {
    const entryPos = ifdOffset + 2 + i * 12;
    if (entryPos + 12 > view.byteLength) break;
    const tag = u16(entryPos);
    const type = u16(entryPos + 2);
    const cnt = u32(entryPos + 4);
    entries.set(tag, { type, count: cnt, valueOffset: u32(entryPos + 8), valuePos: entryPos + 8 });
  }
  return entries;
}

function readAsciiTag(
  view: DataView,
  ifd: Map<number, IfdEntry>,
  tag: number,
  tiffStart: number,
  _little: boolean,
  _u32: (o: number) => number,
): string | null {
  const entry = ifd.get(tag);
  if (!entry || entry.type !== 2 || entry.count === 0) return null; // type 2 = ASCII
  // ASCII <= 4 bytes is stored inline at valuePos; otherwise valueOffset points to it.
  const dataPos = entry.count <= 4 ? entry.valuePos : tiffStart + entry.valueOffset;
  if (dataPos + entry.count > view.byteLength) return null;
  let s = '';
  for (let i = 0; i < entry.count; i++) {
    const c = view.getUint8(dataPos + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim() || null;
}

// EXIF DateTime is "YYYY:MM:DD HH:MM:SS" (local time, no zone). We normalise the
// date separators to "YYYY-MM-DDTHH:MM:SS" so it parses as an ISO 8601 local
// datetime — matching the Agent's takenAt signal contract. No timezone is invented.
function exifDateToIso(raw: string): string | null {
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  if (y === '0000' || mo === '00' || d === '00') return null;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}
