import { downloadBlob, type NamedBlob } from './download';

export type MobileDeliveryResult = 'shared' | 'downloaded' | 'cancelled';

/**
 * 移动端导出的最后一步必须由「保存 / 分享」按钮直接调用。
 *
 * 渲染阶段已经准备好所有 Blob 和单文件兜底，因此这里在任何 await 之前就能打开
 * 系统分享面板；分享不可用时也只触发一次下载，避免移动浏览器吞掉连续自动下载。
 */
export async function deliverMobileExportAssets(
  files: NamedBlob[],
  fallback: NamedBlob,
): Promise<MobileDeliveryResult> {
  const shareFiles = files.map(
    ({ blob, name }) => new File([blob], name, { type: blob.type || 'application/octet-stream' }),
  );
  const shareData: ShareData = { files: shareFiles };

  if (
    typeof navigator !== 'undefined' &&
    navigator.share &&
    (!navigator.canShare || navigator.canShare(shareData))
  ) {
    try {
      await navigator.share(shareData);
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // 分享能力被系统临时拒绝时，回落到预先准备好的单文件下载。
    }
  }

  downloadBlob(fallback.blob, fallback.name);
  return 'downloaded';
}
