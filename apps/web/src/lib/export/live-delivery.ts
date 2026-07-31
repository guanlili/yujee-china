// Live 导出的**交付**规则。桌面(EditorPort)与移动端(use-export)共用这一份。
//
// 为什么必须共用:这里的每一条都是踩出来的,两端各写一份就会各踩一次。
//
// ① 浏览器兜底只能发起**一次**下载。
//    桌面 Chrome 对「同一站点自动下载多个文件」有站点级权限:第一次放行第一个文件并
//    弹提示,提示被拒/忽略后该站点进黑名单,之后所有自动下载被**静默丢弃** ——
//    表现为「第一次能下、之后进度跑完但没文件」,进度条照跑、代码不抛错、控制台干净。
//    (线上真出过。)
//
// ② 所以封面不单独给。它已经被渲成视频的第一帧(见 nine-grid-motion 的
//    COVER_FRAME_SECONDS),单独给一份是内容冗余。也别用 zip 绕 —— 让用户多解一次
//    压缩包是把技术限制转嫁给用户。
//
// ③ 唯一需要成对素材的是 iOS:Live Photo 要 jpg + 视频**成对**进相册。那条走系统
//    分享面板,分享面板本来就收多文件、也不受 ① 的限制。

import { downloadBlob } from './download';

/** iPad 从 iOS 13 起 UA 伪装成桌面 Safari,platform 仍是 MacIntel —— 只看 UA 会把
 *  iPad 当桌面,于是拿不到分享面板。加 maxTouchPoints 判据补上。 */
export function isAppleMobileDevice(): boolean {
  const platform = navigator.platform || '';
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * 交付一次 Live 导出的产物。
 *
 * @param video  录好的视频
 * @param cover  静帧封面(只在 iOS 分享路径用得上,见抬头 ②③)
 * @param stem   文件名主干(已安全化)
 * @param suffix 样式后缀,如 'page-flip' / 'nine-grid'
 */
export async function deliverLiveAssets(
  video: Blob,
  cover: Blob,
  stem: string,
  suffix: string,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const extension = video.type.includes('mp4') ? 'mp4' : 'webm';
  const files = [
    new File([cover], `${stem}-${suffix}-cover.jpg`, { type: 'image/jpeg' }),
    new File([video], `${stem}-${suffix}-live.${extension}`, { type: video.type || 'video/mp4' }),
  ];
  const shareData = { files, title: `${stem} Live` };
  if (isAppleMobileDevice() && navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
    try {
      await navigator.share(shareData);
      return 'shared';
    } catch (error) {
      // 用户主动取消 = 已经做出选择,不要再自作主张塞一个下载给他。
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // 其余失败(不支持/权限)才回落下载。
    }
  }
  downloadBlob(video, `${stem}-${suffix}-live.${extension}`);
  return 'downloaded';
}
