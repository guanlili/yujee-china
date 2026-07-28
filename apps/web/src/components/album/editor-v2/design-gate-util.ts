/* 纯逻辑:移动端什么时候该接管成画板。抽出来是为了能在 `tsx --test` 下单测,
   不用把整棵 JSX 组件树拉进来(同 export-gate-util.ts / zoom-util.ts 的做法)。

   ── 这里修的是什么 ──
   分流原本只看 `pages.length > 0`,注释把「pages 为空」当成「还在收集故事」的等价条件。
   但排版(select-layout)跑完就有 pages 了,那时封面主题还没选。于是移动端一有页面就整体
   切进 MobileEditorRoot —— 那棵树里没有 ChatPanel,而「选封面 & 封尾」那张必选卡正是
   ChatPanel 弹的(条件 hasPages)。两个条件互斥,结果是移动端**永远看不到那张卡**,
   选主题这步在手机上完全没法操作,书也就永远停在没封面没文案的状态。

   判据用「书里有没有封面页」,与服务端 albumService.listCoverSets 的 designed 同口径
   (rawPages.some(p => templateCategory(p.templateId) === 'cover'))。不用 albums.stage:
   EditorPort 手上的 detail.album.stage 可能不新鲜(见 EditorPort 里 breadcrumbStage
   那段注释,轮询停了它会停在 story);也不用再发一次 GET /design —— pages 就在手上,零成本。 */

import { TEMPLATES } from '@yujee/contracts';

type PageLike = { templateId: string };

/** 书里已经有封面页 = 用户选过封面组、compose 已落库。与服务端 designed 同口径。 */
export function isDesigned(pages: readonly PageLike[]): boolean {
  return pages.some((page) => TEMPLATES[page.templateId]?.category === 'cover');
}

/**
 * 移动端是否接管成独立画板。
 *
 * 三个条件缺一不可:
 * - 手机视口(resolveDeviceMode ≤767)
 * - 有页面(排版完成)
 * - **已选过封面组** —— 没选之前留在桌面那套 EditorShell,让 ChatPanel 把必选封面卡
 *   弹出来(它有 max-width:767px 的移动适配,手机上能用)。选完 compose 回调落库封面页,
 *   这里自然转 true,自动切进画板。
 */
export function shouldMountMobileEditor(
  device: string,
  pages: readonly PageLike[],
): boolean {
  return device === 'mobile' && pages.length > 0 && isDesigned(pages);
}

/**
 * Finalized legacy albums already completed the authoring/design gate. Preserve
 * their historical mobile routing rule while keeping the decision inside
 * EditorPort, where desktop and mobile can share live editor state.
 */
export function shouldMountLegacyMobileEditor(
  device: string,
  pages: readonly PageLike[],
): boolean {
  return device === 'mobile' && pages.length > 0;
}
