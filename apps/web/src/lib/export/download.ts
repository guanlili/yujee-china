// 导出下载小工具：单 blob 直下 / 多文件逐个直下。拼图与单页 JPG 共用。
//
// 这里**没有** zip 打包器,是删掉的、不是漏了:压缩包在手机上存不进相册、看不了图,
// 等于没导出(见 mobile/export-no-zip.test)。移动端多文件走系统分享面板,分享走不通
// 就由用户逐张点着存(lib/export/mobile-delivery.ts)。

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
