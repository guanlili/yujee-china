'use client';

export type CompressedPhoto = {
  photoId: string;
  base64: string;
  width: number;
  height: number;
  // EXIF capture time (ISO 8601), used as a deterministic chaptering signal by the
  // Agent. `null` when the file carries no readable EXIF DateTime. PRIVACY (D-GPS,
  // architecture §3): this is the ONLY EXIF field we ever read — `readTakenAtFromExif`
  // has no code path that touches the GPS IFD, so coordinates can never leak out.
  takenAt: string | null;
};

// Accepts a Blob (File is a Blob) so we can re-compress originals read back from
// IndexedDB — the resume-after-purchase and failed-album retry flows rebuild the
// 800px base64 from the stored original instead of persisting the base64 itself.
export async function compressFile(file: Blob, photoId: string): Promise<CompressedPhoto> {
  const bytes = await readAsArrayBuffer(file);
  const takenAt = readTakenAtFromExif(bytes);
  const dataUrl = arrayBufferToDataUrl(bytes, file.type || 'image/jpeg');
  const img = await loadImage(dataUrl);
  const { canvas, w, h } = drawScaled(img, 800);
  const base64 = canvas.toDataURL('image/jpeg', 0.6);
  return { photoId, base64, width: w, height: h, takenAt };
}

function readAsArrayBuffer(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(file);
  });
}

function arrayBufferToDataUrl(bytes: ArrayBuffer, mime: string): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
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

// --- EXIF takenAt reader (takenAt ONLY — never GPS) -------------------------
//
// Minimal, dependency-free JPEG APP1/EXIF parser. It walks the TIFF IFD0 +
// Exif sub-IFD and returns ONLY the capture timestamp from one of three tags:
//   - 0x9003 DateTimeOriginal   (preferred)
//   - 0x9004 DateTimeDigitized  (fallback)
//   - 0x0132 DateTime           (fallback)
// It deliberately NEVER follows the GPS IFD pointer (tag 0x8825), so no
// coordinate can ever be parsed out (architecture §3 D-GPS red line).

const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_DATETIME = 0x0132;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME_DIGITIZED = 0x9004;

export function readTakenAtFromExif(bytes: ArrayBuffer): string | null {
  try {
    const view = new DataView(bytes);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null; // not a JPEG (SOI marker)

    // Find the APP1 (0xFFE1) segment carrying the "Exif\0\0" header.
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xff) break;
      const marker = view.getUint8(offset + 1);
      if (marker === 0xda) break; // start of scan — no metadata beyond here
      const segLen = view.getUint16(offset + 2);
      if (segLen < 2) break;
      if (marker === 0xe1) {
        const tiffStart = offset + 4 + 6; // skip "Exif\0\0"
        if (
          offset + 4 + 6 <= view.byteLength &&
          view.getUint32(offset + 4) === 0x45786966 && // "Exif"
          view.getUint16(offset + 8) === 0x0000
        ) {
          return readDateFromTiff(view, tiffStart);
        }
      }
      offset += 2 + segLen;
    }
    return null;
  } catch {
    return null; // any malformed EXIF → treat as no timestamp, never throw
  }
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
