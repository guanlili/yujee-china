import { downloadBlob, type NamedBlob } from './download';

/**
 * 'manual' = 分享走不通且不止一个文件 → 交给 UI 列出来,让用户逐张点着存。
 * 'wechat' = 微信内置浏览器:它没有 Web Share,`<a download>` 也不落地 ——
 * 再往下载里走就是"点了没反应",必须让 UI 改口叫用户去浏览器打开。
 */
export type MobileDeliveryResult = 'shared' | 'downloaded' | 'cancelled' | 'manual' | 'wechat';

/** 微信/企业微信内置浏览器(国内用户的主力入口,链接多从聊天里点开)。 */
export function isWeChatBrowser(
  ua: string | undefined = typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
): boolean {
  return !!ua && /MicroMessenger/i.test(ua);
}

/**
 * 移动端导出的最后一步必须由「保存 / 分享」按钮直接调用。
 *
 * 渲染阶段已经准备好所有 Blob,因此这里在任何 await 之前就能打开系统分享面板 ——
 * 分享面板本来就收多文件、直接进相册,是手机上唯一体面的多文件交付方式。
 *
 * 分享走不通时**不打包也不连发**:
 *   · 打包成 zip = 让用户在手机上多解一次压缩包,相册还是存不进(见 export-no-zip.test)
 *   · 连发多个自动下载 = 站点进 Chrome 黑名单后被静默丢弃,手机上也常只落最后一张
 *     (见 export-download-wiring.test 抬头的真实事故)
 * 只有一个文件时直接下(一次下载,不受上面那条限制);多于一个就回 'manual',
 * 由弹窗列出文件、每点一次调 saveExportFileAt 存一张。
 */
export async function deliverMobileExportAssets(
  files: NamedBlob[],
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
      // 分享能力被系统临时拒绝 → 落到下面的手动路径。
    }
  }

  // 微信里既没有分享面板、`a.download` 也不落地:直接回去让 UI 说清怎么在浏览器里导出,
  // 不然用户点完「保存」看到的是"什么都没发生",会以为导出坏了。
  if (isWeChatBrowser()) return 'wechat';

  const only = files.length === 1 ? files[0] : undefined;
  if (!only) return 'manual';
  downloadBlob(only.blob, only.name);
  return 'downloaded';
}

/** 逐张保存:一记点击落一个文件。索引越界是调用方的错,静默不做事即可。 */
export function saveExportFileAt(files: NamedBlob[], index: number): void {
  const file = files[index];
  if (!file) return;
  downloadBlob(file.blob, file.name);
}
