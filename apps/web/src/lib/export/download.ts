// 导出下载小工具：单 blob 直下 / 多文件 zip 打包下载。拼图与单页 JPG 共用。

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface NamedBlob {
  name: string;
  blob: Blob;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipHeader(size: number): DataView {
  return new DataView(new ArrayBuffer(size));
}

/**
 * 轻量 ZIP（store / 无压缩）：用于把封面 JPG 与视频作为一个 Live 图素材包下载。
 * 文件本身已经是 JPEG/MP4/WebM，再压缩收益很小，因此不引入额外压缩依赖。
 */
export async function createZipBlob(files: NamedBlob[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const localParts: ArrayBuffer[] = [];
  const centralParts: ArrayBuffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    const nameBuffer = name.slice().buffer as ArrayBuffer;
    const bytesBuffer = bytes.slice().buffer as ArrayBuffer;
    const crc = crc32(bytes);
    const local = zipHeader(30);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.byteLength, true);
    local.setUint32(22, bytes.byteLength, true);
    local.setUint16(26, name.byteLength, true);
    localParts.push(local.buffer as ArrayBuffer, nameBuffer, bytesBuffer);

    const central = zipHeader(46);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, bytes.byteLength, true);
    central.setUint32(24, bytes.byteLength, true);
    central.setUint16(28, name.byteLength, true);
    central.setUint32(42, offset, true);
    centralParts.push(central.buffer as ArrayBuffer, nameBuffer);
    offset += 30 + name.byteLength + bytes.byteLength;
  }

  const centralSize = centralParts.reduce((size, part) => size + part.byteLength, 0);
  const end = zipHeader(22);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob(
    [...localParts, ...centralParts, end.buffer as ArrayBuffer],
    { type: 'application/zip' },
  );
}

// 多张图片逐个直接下载（不打包）。每张之间留个小间隔，避免浏览器把连续下载丢掉。
// 桌面 Chrome 首次会弹「允许下载多个文件」；手机浏览器多文件下载不稳(可能只落最后一张)。
export async function downloadBlobs(files: NamedBlob[], staggerMs = 300): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    downloadBlob(files[i]!.blob, files[i]!.name);
    if (i < files.length - 1) await new Promise((r) => setTimeout(r, staggerMs));
  }
}

// 文件名安全化：去掉路径/非法字符，空则回退。
export function safeFileStem(title: string, fallback = 'album'): string {
  const stem = title.replace(/[\\/:*?"<>|]+/g, '').trim();
  return stem.length > 0 ? stem : fallback;
}
